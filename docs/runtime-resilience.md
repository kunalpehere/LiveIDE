# Terminal and preview resilience (Day 15)

## Terminal limits and scheduling

The terminal uses xterm's 1,000-line scrollback plus a bounded screen (at most
500 columns and 200 rows). Its pending output uses a fixed 128K UTF-16-code-unit
ring buffer (256 KiB), rather than retaining slices of arbitrarily large strings.
Only one xterm write is in flight, at most 16K code units plus a short notice.
Parser callbacks provide backpressure; batches are scheduled 16ms apart so input
and layout can run. SDK startup/server output and foreground command streams also
yield after each 16K output code units, avoiding long chains of microtasks.

A burst that exceeds pending capacity drops the oldest pending output and keeps
the latest tail. The terminal shows an omission notice. Ordinary output remains
ordered; overload can interrupt an ANSI sequence, so the notice resets parser/
style state. This is a bounded interactive view, not an archival process log.
Download exports the currently parsed retained buffer, excluding pending and
omitted output. Clear resets pending output and the xterm buffer, waiting for
an in-flight parse before reset so old queued text cannot reappear.

Command history retains at most 200 entries, each bounded by the 4,096-code-unit
input limit. Paste controls cannot submit multiple commands. The current terminal
is a command runner: it splits arguments on whitespace and supports clear,
history, help, and project commands. It is not a full shell quoting/parser or an
interactive stdin session. This milestone does not expand execution permissions.

Output consumers release their reader locks on cancellation instead of cancelling
the SDK-owned source. This permits the vendor bridge to close a killed process
late without trying to close an errored stream. Source failures surface as runtime
or command failures, while old consumers stop forwarding data.

Commands run only while the runtime is ready, one foreground command at a time.
Ctrl+C and Stop terminal command cancel a command or pending spawn; late processes
are killed. Command exit codes, launch failures and stream failures produce clear
messages and a new prompt. An output stream that remains open after process exit
gets one second to drain before cancellation, with an explicit message if its
remaining output cannot be consumed.

The terminal keeps its xterm instance through theme, callback, readiness and
runtime-failure changes. A runtime Stop/failure cancels its foreground command but
keeps retained output available. Hiding/removing the preview panel ends that
terminal's foreground command and disposes its buffer/history; the service-owned
development server remains governed by the reusable runtime session. Changing
projects resets the panel to avoid carrying another project's logs/history.

## Preview and failure isolation

Server-ready state and iframe navigation are separate. The preview displays
Loading preview, Preview frame loaded, or Preview could not load. A 20-second
navigation timeout and native iframe error events expose Reload, Open in new tab,
and Restart runtime recovery controls. Reload replaces only the iframe, retaining
the server, dependency installation, terminal, and editor. Navigation attempts are
scoped so late events from a replaced iframe do not change a new attempt's state.

Cross-origin iframe load events do not prove HTTP success or application health.
Some browser error pages and application exceptions still emit load. LiveIDE does
not claim to inspect inaccessible remote status codes or application internals.
Runtime process exits remain detected by the service and expose Start/Retry.

A local React error boundary contains runtime-panel display failures. Retry runtime
panel remounts that panel, leaving the sibling editor and drafts untouched. Runtime
failure views retain the terminal so recent diagnostics can still be searched,
selected, downloaded or cleared. Async terminal parser/resize errors are routed to
this boundary rather than escaping timer callbacks into the whole workspace.

## Verification

```powershell
npx vitest run tests/terminal-output.test.ts tests/terminal-lifecycle.test.tsx tests/preview-recovery.test.tsx tests/webcontainer-lifecycle.test.ts tests/webcontainer-workspace.test.tsx --maxWorkers=1
npm run lint
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:e2e
```

Use production-safe build settings as described in the quality pipeline. The real
WebContainer test additionally needs supported browser isolation and SDK/npm
network access:

```powershell
$env:LIVEIDE_RUNTIME_RESILIENCE='1'
npx playwright test e2e/runtime-resilience.spec.ts --project=chromium
Remove-Item Env:LIVEIDE_RUNTIME_RESILIENCE
```

It runs a real 50,000-line Node command (100 batches of 500 real newline-separated
lines, paced at 25ms), edits an unsaved Monaco draft while output
runs, checks normal/nonzero exits, reloads the iframe without replacing Monaco,
injects an iframe error to verify recovery controls, then stops the runtime and
checks editor/model/draft identity. Injected iframe errors verify UI recovery;
they are not a claim that all cross-origin HTTP failures can be detected.
Measurements are attached to Playwright and written to
`reports/runtime-resilience.json`. The edit latency includes Playwright roundtrip
and UI acknowledgement; it is not a pure keystroke benchmark.

Local verification on October 6, 2026:

- All 219 unit/integration tests passed across 43 files.
- Repository lint, application/transport type checking and the production build passed.
- Twelve standard browser scenarios passed, followed by the opt-in real
  WebContainer resilience scenario (13 distinct scenarios overall). The Day 14
  startup benchmark was not rerun for this milestone.
- The real command completed 50,000 lines. The unsaved draft acknowledgement took
  544ms while output was still active, including Playwright roundtrip overhead.
  Preview reload/recovery, nonzero exit code 7 and runtime Stop preserved the
  Monaco instance, model and draft. No uncaught error was captured during the
  checked post-readiness scenario.
- The live check exposed an SDK stream-close race on Stop. Releasing consumer
  reader locks fixed it; the corrected real scenario and regression tests passed.
- Ports 3000, 1234, 3100 and 3200 were released after verification. Build settings
  used process-only environment overrides; `.env.local` was not edited.

These are local results, not a hosted GitHub Actions or deployed performance run.
No commit, push or deployment was performed.

## Scope

No shared terminal stream, shared shell, invitation changes or Day 16 follow mode
is included. Collaboration snapshot HTTP 500/reconnecting remains independent.

## Day 15 follow-up 1: Run controls and live source preview

The workspace header now has **Run**, plus an opt-in **Live preview** checkbox.
The preview header labels **Stop** and **Restart** visibly. Existing automatic
startup remains available; Run opens a hidden preview and applies current source
drafts to a ready runtime. If stopped/failed, Run starts from a draft snapshot.
Restart explicitly replaces the server using that snapshot. These actions do not
save project data or clear dirty indicators.

Live preview is off by default. When enabled for an editor/owner, it coalesces
source edits across open files after a 500ms pause. It uses a store subscription,
so draft text does not enter broad workspace React state. File writes reuse the
service's serialized queue, preserve Monaco/models, and do not call setup or npm
installation for ordinary source edits. Returning to saved source or closing a
previewed draft restores the saved content on the next synchronization.

Dependency inputs (package manifests, npm lockfiles and .npmrc) are excluded from
automatic syncing. Save or explicitly Run/Restart to apply those changes; Run
with changed dependency drafts can require installation. Runtime/bundler config
source changes may trigger the development server's own reload behavior.

Turning Live preview off cancels pending debounce work and keeps the last applied
preview. An already-started filesystem write can finish. Stop, route changes and
unmount cancel scheduled work, and service project/run guards isolate late work.
Live mode does not automatically resume a stopped runtime. Save remains the
persistence action; saving while more text is typed preserves the newer draft.
Unsaved runtime content is temporary and can be lost on refresh/session teardown.

Focused regression tests cover debounce, reverts, cancellation, project changes,
source versus dependency Run behavior, failed writes, viewer access and path-based
draft overlays. The opt-in real preview scenario is:

```powershell
$env:LIVEIDE_LIVE_PREVIEW='1'
npx playwright test e2e/live-preview.spec.ts --project=chromium
Remove-Item Env:LIVEIDE_LIVE_PREVIEW
```

Follow-up verification on October 6, 2026:

- The final full suite passed 228 tests across 44 files, including nine new
  draft-sync regressions. An initial concurrent verification attempt exceeded a
  collaboration service startup deadline; isolated full runs passed.
- Repository lint, application/transport type checks and the final production
  build passed. Production build settings were process-only overrides.
- The final browser run passed 13 scenarios, including the opt-in real React/Vite
  preview scenario. The existing terminal-flood and startup-benchmark opt-ins were
  skipped for this follow-up; their previous Day 15/Day 14 results remain above
  and in the startup guide.
- Real checks confirmed Run without Save, live heading updates, disabled live
  mode retaining the prior preview, Stop/Run using the current unsaved draft,
  unchanged startup measurements during source updates, and stable Monaco/model
  identity. Saving remains separate from temporary runtime draft synchronization.

No commit, push, deployment or `.env.local` edit was performed. The verification
services were stopped after checking; this remains a local verification result.

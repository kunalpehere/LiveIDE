# Dependency reuse and startup measurements (Day 14)

## Behavior

Project setup remains automatic. The current executor uses `npm install` and
`npm run start`. A successful installation is reusable within the retained
WebContainer for the same project. Stop/Start and Restart remount the latest
project files and restart the server, but skip npm when inputs are unchanged.
Closing the workspace, a page reload, switching projects, an SDK failure, or
retiring a container discards reuse. This is not a persistent download cache.

Installation inputs include every project `package.json`, `package-lock.json`,
`npm-shrinkwrap.json`, and `.npmrc`, including nested workspace files. File order
does not affect comparison; additions, removals and content changes do. Exact
serialized comparison avoids hash collisions and stays in service memory; file
contents and configuration are not exposed in timing reports. Formatting-only
manifest changes conservatively trigger installation.

Local `file:`/`link:`/relative dependencies and npm preinstall/install/postinstall/
prepare scripts may consume source. For these projects, all managed source files
are included conservatively. Other source saves keep the running server and do
not install dependencies. LiveIDE-managed files removed from the next project
snapshot are removed before mounting so deleted lockfiles do not linger.
Generated npm files and node_modules remain available for unchanged restarts.

Concurrent automatic preparation requests share work. A manifest saved during an
install is flushed, compared again, and installed before starting the server.
A save during server startup replaces preparation when needed. Saving after Stop
never resumes execution; the latest saved snapshot is used on Start.

Only a successful, still-current installation is cached. Failures/timeouts retry
installation. Cancelling or timing out an in-progress npm process retires that container because
partial npm mutations may continue after process termination. A server-start
failure can reuse its preceding successful dependency installation. User terminal
commands conservatively invalidate reuse because they can change dependencies or
configuration outside LiveIDE's save path.

## Measurements and UI

The preview displays cold/warm startup, mount, install, server-start and total
seconds; reused installation is explicitly labelled and recorded as zero work.
Progress steps identify the active phase; they are not a download percentage or
an estimated completion time. Boot/acquisition duration is also recorded in the
service snapshot. Updates happen at phase boundaries, with no render timer.

`cold` means there is no successful installation marker; `warm` means the retained
session had one at the start of preparation. A warm run can still install when its
inputs changed. Total time runs from requested preparation to ready, including
acquisition/queueing, file flushing and server readiness. Timings describe that
request, not navigation-to-editor latency. Only a completed startup has total time.

## Repeatable checks

```powershell
npx vitest run tests/webcontainer-startup.test.ts tests/webcontainer-lifecycle.test.ts tests/webcontainer-workspace.test.tsx --maxWorkers=1
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

For the actual WebContainer/npm benchmark, enable the opt-in browser scenario:

```powershell
$env:LIVEIDE_RUNTIME_BENCHMARK='1'
npx playwright test e2e/runtime-startup.spec.ts --project=chromium
Remove-Item Env:LIVEIDE_RUNTIME_BENCHMARK
```

This uses the real React TypeScript starter, waits for its server-ready preview,
restarts the same retained project, asserts dependencies were reused, attaches
cold/warm displayed phase timings, and checks warm total is lower. It requires
network access to the SDK and npm services and a supported isolated browser.
Run several times on the intended deployment for representative results. A failure
preserves browser trace/screenshot and startup context; it does not substitute
fixture measurements or count an unfinished boot as a successful benchmark.

## Verification record — October 6, 2026

The deterministic clock regression measures 650ms cold (100ms acquisition, 20ms
mount, 500ms install, 30ms server) and 50ms warm (20ms mount, 30ms server), with one
installation across both runs. These are simulated test inputs for timing and
reuse correctness, not user-facing performance measurements.

The real WebContainer/npm React TypeScript starter benchmark passed in local
Chromium on Windows with the Next development server:

| Measurement | Cold startup | Retained warm restart |
| --- | ---: | ---: |
| Mount | 0.17s | 0.08s |
| Dependency installation | 100.05s | 0.00s (reused) |
| Server start to ready | 8.65s | 6.03s |
| Total preparation to ready | 113.03s | 6.24s |

One measured warm restart was about 94.5% faster. Values are displayed measurements
rounded to hundredths of a second. Total also includes acquisition/queueing and
file flushes, so the displayed phase rows need not sum exactly to total. This is
one local run, not a deployment benchmark or guarantee for other projects. The
initial installation still downloaded dependencies; only the retained warm run
skipped it. The machine/network and vendor caches influence cold results.

The first benchmark attempt did not select a file, leaving preview unrendered even
though the runtime was ready. Selecting App.tsx corrected the harness; the live
benchmark then passed without SDK mocks. The JSON measurements are retained in
`reports/runtime-startup.json` and attached to the Playwright HTML report. Future
benchmark runs write that JSON report directly.

- Full unit/integration suite: 193 tests passed across 39 files. Five subsequent
  edge cases also passed in focused verification: 198 distinct tests exercised.
- Final runtime verification: 47 focused tests passed, followed by all 17 startup
  tests passing after the npm timeout retirement guard was added.
- Repository lint, application/transport type checking, and the final production
  build passed. Build verification used process-only settings and preserved `.env.local`.
- Twelve regular browser checks passed; the corrected real startup benchmark also
  passed (13 distinct browser scenarios).
- Test services stopped; ports 3000, 1234, 3100, and 3200 were verified released.
- No hosted CI, commit, push, or deployment was requested or performed.

## Scope

Terminal output limits and preview recovery are documented in
[Day 15 runtime resilience](runtime-resilience.md).
The earlier collaboration snapshot HTTP 500/reconnecting issue is independent.

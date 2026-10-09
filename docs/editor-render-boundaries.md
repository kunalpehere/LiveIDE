# Editor render boundaries (Day 12)

The playground shell previously called `useFileExplorer()` without a selector.
Every draft update replaced `openFiles` and `editorContent`, causing the page,
explorer, header, tabs, preview, terminal, and AI controls to render again.
Inline editor callbacks also changed identity on every page render, and a new
Monaco options object was allocated on every editor render.

## Boundaries

- The page subscribes to stable file actions and the active file ID.
- `useWorkspaceFiles` exposes only ordered file identities, names, extensions,
  and dirty flags. The first edit and undo back to the saved value update the
  shell because its Save buttons, tabs, and status need to change. Further
  keystrokes in the same dirty draft do not update the shell.
- `WorkspaceEditor` alone subscribes to the active file's draft. Its memo
  boundary prevents unrelated page/panel state from rendering the editor.
- Save and Save all read current drafts from the store at invocation time;
  the shell does not retain content in its props or closures.
- Content remains in the existing external store for persistence and file
  switching. Monaco and Yjs continue to own immediate editing and collaboration.

The editor uses a project-scoped, file-scoped Monaco URI. Switching tabs changes
the attached model, preserving each model's undo history and the wrapper's saved
view state. The editor panel has a fixed ID/order and stays mounted when Preview
changes visibility. Monaco options are memoized by read-only status, and language
and inline-completion effects depend on the extension rather than the whole draft.
Inactive models retained for tab switching are disposed when the editor leaves
the workspace; the Monaco wrapper disposes its currently attached model.

## Repeatable profiling and verification

Run `npx vitest run tests/workspace-renders.test.tsx`. The React Profiler scenario
applies 30 separate draft updates to the real file store. It compares the previous
whole-store subscription with the new metadata subscription: the expected counts
are 30 baseline commits versus one metadata commit (clean to dirty). Undo to clean
must cause a second metadata commit. This is a scoped render-count measurement,
not a production latency benchmark or a full browser CPU profile.

Run `npx playwright test e2e/editor-stability.spec.ts --project=chromium` after a
production build, as the shared Playwright configuration also starts a production
security server. The test uses real Monaco to check editor/model identity across
Preview visibility, History, and AI chat; then switches tabs and verifies model
identity, retained draft text, and undo. AI availability is stubbed so opening its
panel requires no external provider. Preview visibility also controls the terminal
subtree; this check does not certify a successful WebContainer boot or installation.

For a manual browser profile, use React DevTools Profiler in development, open a
file, and type after its dirty indicator appears. The page/header/explorer/preview
should not render from those subsequent keystrokes. Record panel changes separately
and inspect Monaco's instance/model identity rather than treating every React
render as a remount. Development Strict Mode and initial runtime/AI availability
updates can add commits, so exclude startup from typing measurements.

Runtime boot, npm installation, dependency caching, and the outstanding live
collaboration snapshot HTTP 500 are outside this change. Days 13–14 address runtime
lifecycle and startup work; Day 12 does not make dependency installation faster.

## Verification record — October 6, 2026

- React Profiler fixture: 30 separate updates produced 30 commits with the
  previous broad subscription and one with workspace metadata. Undo to clean
  produced the expected second metadata commit.
- All 154 unit/integration tests passed with `npx vitest run --maxWorkers=1`.
  The initial parallel run, alongside browser-server startup, had seven
  child-process startup timeouts. The serial rerun passed without changing
  server code or test deadlines.
- Repository lint passed with one cleanup-ref warning, which was corrected;
  lint of all final changed code/test files then passed without warnings.
- Application/transport type checking and the final production build passed.
  The first build correctly rejected development mock settings. The successful
  build used process-only production verification settings, with mock mode and
  collaboration disabled; `.env.local` was preserved.
- All 11 browser tests passed, including real Monaco instance/model identity,
  retained draft/undo, disposal after closing all files, and existing production
  CSP/worker checks. The stability test's `browser-errors` attachment recorded
  no uncaught JavaScript exceptions. A generic monitoring event occurred during
  that test; its cause was not identified by this check.
- Test servers stopped; ports 3000, 1234, 3100, and 3200 were released. No hosted
  CI run, commit, push, or deployment was performed.

These checks do not certify live MongoDB/Redis deployment behavior, successful
WebContainer installation, or resolution of the earlier collaboration snapshot
failure.

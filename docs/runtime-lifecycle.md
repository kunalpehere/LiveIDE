# WebContainer session lifecycle (Day 13)

LiveIDE has one active execution project per browser tab. The workspace owns its
runtime lease; preview and terminal visibility do not own that lease. Hiding a
panel therefore does not reboot, remount, reinstall, or stop the project server.
The editor remains available when execution is stopped or has failed.

## State and ownership

`WebContainerSessionService` owns the container, startup operation, project ID,
processes, output streams, and lifecycle snapshot. `useWebContainer` reads that
snapshot through `useSyncExternalStore`, including the current container instance.
Retry after a failed boot can consequently deliver a newly booted instance to
React instead of retaining a separate stale `instance` state.

| State | Meaning |
| --- | --- |
| `idle` | Initial state or a booted container awaiting mounting. |
| `booting` | Waiting for the shared SDK boot operation. |
| `mounting` | Mounting this project's files. |
| `installing` | Running `npm install`; bounded to three minutes. |
| `starting` | Launching `npm run start` and waiting up to 60 seconds for readiness. |
| `ready` | A server-ready URL has arrived; the server process remains monitored. |
| `stopped` | User cancellation, clean server exit, or final lease teardown. |
| `failed` | Boot/mount/install/launch error, timeout, unexpected server exit, or SDK error. |
| `unsupported` | Required browser capabilities are unavailable; guidance remains visible. |

The former `running` and `error` names are now `ready` and `failed`. Preview and
status-bar consumers use the same contract. Stop clears the preview URL; Start
resumes setup for the retained project. Failed operations offer Retry without
reloading the page. Unsupported browser conditions retain their specific guidance.

## Reuse, cancellation, and cleanup

- Concurrent boot callers share a promise. Same-project setup requests share the
  pending operation or reuse a ready session. The latest saved file tree is still
  retained for the next explicit restart.
- Setup operations are ordered. A replacement aborts the old operation, kills
  its tracked install/server/terminal processes, cancels output forwarding, and
  removes readiness listeners and deadlines. Cancelled callers settle promptly;
  their late callbacks cannot update the current project or preview URL.
- Mount, spawn, and filesystem operations do not accept SDK cancellation signals.
  Cancellation during an in-flight mutation retires that container. Processes
  returned by a cancelled spawn are killed, and late failures are observed to
  avoid unhandled promise rejections.
- Switching projects uses a fresh container so the old root filesystem and
  dependencies cannot leak into the next project. Same-project reuse remains
  the normal path; cross-project cache reuse is not attempted.
- The SDK allows only one container to boot concurrently. A retired pending boot
  remains a barrier: its late result is disposed before another boot starts.
  Stop during boot cancels logical setup immediately; if boot later succeeds
  while the lease remains active, its container stays stopped until Start.
- Final lease release waits 250 ms before teardown, preserving a container
  through React Strict Mode's short mount/unmount/remount cycle. Changing project
  identity cancels the previous project immediately, including while new files
  are loading. Old hook Stop/Restart/terminal callbacks cannot affect the new one.
- A nonzero server exit marks execution failed even after readiness. A clean
  exit marks it stopped. Internal SDK errors retire the broken container so Retry
  gets a fresh instance.

File saves do not start a stopped or failed runtime. Source saves during startup
are buffered and flushed after mount, after install, and before showing a ready
preview; an already-running mount cannot overwrite a newer saved draft. Ready
filesystem writes are ordered, and cancellation does not block durable saving.
A package.json save restarts execution only if the matching project is still
active at save completion, so Stop during an asynchronous save remains authoritative.
The latest saved tree will be mounted by the next explicit Start or Retry.
Runtime UI retry promises are handled; cancellation/failure does not create a
separate unhandled rejection.

## Verification

Run the service and React integration regressions:

```powershell
npx vitest run tests/webcontainer-session-service.test.ts tests/webcontainer-lifecycle.test.ts tests/webcontainer-workspace.test.tsx --maxWorkers=1
```

They exercise shared boot/setup, Strict Mode, preview/terminal visibility, boot
retry and instance replacement, installation failure/timeout, early and later
server exits, readiness timeout, SDK failure, Stop/Start, project isolation, late
boot/mount/spawn completion, concurrent commands, stream/listener cleanup, and
cancelled filesystem writes. The SDK is injected in these tests; failure scenarios
are deterministic and do not require vendor availability.

After a production build, run `npx playwright test`. The runtime lifecycle browser
test stops startup, edits and saves a source file while stopped, starts/stops again,
and verifies Monaco and its draft stay intact. It restores the shared guest source
after saving. Existing browser tests still cover production CSP and Monaco workers.

These checks distinguish lifecycle correctness from successful execution: the
browser scenario can cancel an unfinished SDK boot and does not establish that
the vendor runtime, dependency installation, and live project server succeed on
the deployment. An SDK boot with no cancellation API must settle before its
replacement can safely boot; stopping the logical operation cannot force that
external promise to resolve.

### Verification record — October 6, 2026

- Final repository lint and application/transport type checks passed.
- All 181 unit/integration tests across 38 files passed with one worker, including
  31 runtime service/React regressions. The SDK mkdir fixture was corrected to
  match the installed API's string return type during verification.
- The production build passed with process-only verification settings: mock
  mode and collaboration disabled, valid temporary authentication configuration,
  and a build-only MongoDB URL. `.env.local` was preserved.
- All 12 Chromium browser checks passed, including actual Stop/Start controls,
  saving while stopped, stable Monaco models, and production CSP/worker checks.
  The Stop/Start check cancels startup; it does not certify a completed real
  WebContainer install and running project server.
- Test services stopped; ports 3000, 1234, 3100, and 3200 were released.
- No hosted GitHub Actions run, commit, push, or deployment was performed.

## Scope boundary

Project setup still starts automatically and a fresh setup still runs `npm install`.
Dependency comparisons, reuse of successful installations, and cold/warm startup
measurements are now described in [Day 14 startup optimization](runtime-startup.md). Terminal history/output limits
and preview recovery are described in [Day 15 runtime resilience](runtime-resilience.md). The earlier collaboration snapshot
HTTP 500 and reconnecting issue remain a separate investigation.

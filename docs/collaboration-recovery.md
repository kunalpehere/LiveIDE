# Collaboration connection recovery

Day 8 adds `CollaborationSession`, the single owner of connection attempts for each mounted collaborative file. The editor displays the following states and exposes **Retry collaboration** after failure.

| State | Meaning |
| --- | --- |
| `connecting` | Initial authorization and document synchronization are pending. |
| `connected` | This socket has applied the server's Yjs sync step 2. |
| `reconnecting` | A recovery attempt or its backoff delay is pending. |
| `offline` | The browser reports no network; automatic attempts pause. |
| `failed` | Authorization/protocol failure or the retry budget requires user action. |

`disabled` remains the hook's state when collaboration cannot be enabled for that editor. Browser online status is a hint, not a reachability guarantee: service failures while the browser reports online use the retry policy.

## Retry policy

Each attempt fetches a fresh token through the authenticated application API before opening a socket. An attempt has a 15-second deadline covering token fetch, connection, and initial synchronization. A failed attempt waits using exponential equal jitter: a cap of `min(15 seconds, 500 ms × 2^(attempt - 1))`, with a random wait between half that cap and the cap. Eight unsuccessful attempts end in `failed`. A successful synchronization resets the budget for the next outage. Repeated short successful connections can therefore begin new budgets.

The session constructs y-websocket with `connect: false`, registers its handlers, and then connects. On close, it disables the upstream provider's automatic reconnection before that provider schedules its delayed callback. The old provider is destroyed before the next attempt. Upstream callbacks already scheduled after a natural close can briefly remain, but they see `shouldConnect: false` and cannot open a socket. There is one session retry timer and one attempt deadline.

Offline events cancel pending timers, abort token requests, retire the transport, and clear remote presence. An online event initiates recovery once; duplicate events and duplicate `start()` calls do not create additional active connections. Offline does not consume additional attempts. Explicit retry resets the failed session's attempt budget and rechecks access.

## Authorization and terminal failures

Token API authentication/authorization failures, protocol incompatibility, and inconsistent room identity stop automatic retries. Fatal WebSocket close codes 1002, 1008, 1009, 4003, and 4009 also stop automatic retries. Expiry (4001) requests a fresh token and reconnects. The existing document may not migrate into another project, file, revision, user identity, or role when new authorization is obtained; reload/open the appropriate revision to start a fresh document.

Browsers do not expose HTTP status or bodies from a rejected WebSocket upgrade. A token accepted by the application but rejected by the collaboration service therefore consumes the bounded connection retry budget and ends with a general service/access explanation. The real-socket test verifies this with expired signed tokens. [Day 10 authorization](collaboration-authorization.md) adds active-session expiry enforcement and membership/revision invalidation.

## Document, presence, and cleanup

The Yjs document, its client ID, one awareness instance, and the Monaco binding survive transport replacement. Edits made after the first successful binding remain in that document while disconnected. Each new socket runs [Day 7's state-vector handshake](differential-synchronization.md), merging missing updates in both directions without reinserting initial content. `connected` describes this client's synchronization, not an acknowledgment from every peer or from durable storage.

Retired sockets have native callbacks detached, preventing late messages from modifying the surviving document or late closes from clearing a newer connection's presence. Providers unregister document/awareness listeners and heartbeat intervals on destruction. Remote presence states and their cached clocks are cleared locally during transport retirement, allowing a fresh server snapshot to restore unchanged peers immediately. The local state and client ID persist, avoiding duplicate participants.

Unmount/file changes dispose the session, abort work, remove browser network listeners, cancel session timers, destroy the binding/awareness, and destroy the file's document. A generation guard rejects late authorization results from an earlier attempt. This also handles React Strict Mode's setup/cleanup cycle.

Offline edits are held in the open tab's memory. Closing/reloading the tab or switching files can discard changes that have not reached the server. This stage adds no browser durable offline store, storage acknowledgment protocol, distributed Redis recovery guarantee, or deployment configuration.

## Verification

`tests/collaboration-session.test.ts` exercises bounded jitter/backoff, attempt exhaustion, explicit retry, offline/online transitions, duplicate events, synchronization deadlines, terminal failures, room revision changes, canceled requests, and stale completions with fake time.

`tests/collaboration-recovery-wire.test.ts` starts and restarts the actual standalone service. Two session clients independently edit across an offline period, recover through a server restart, and retain their original document/presence IDs. It checks exact content, two active sockets, one update listener per document after recovery, zero update listeners after disposal, and bounded expired-token rejection. This restart fixture deliberately has no durable server checkpoint: surviving clients restore the room through Yjs synchronization. `npm run verify:collaboration:persistence` separately checks checkpoint restoration with the local snapshot fixture.

Run lint, type checking, the full unit/integration suite, production build, Playwright, and the persistence verifier before marking this day complete. Live Redis and deployed-service recovery remain separate deployment checks.

On October 5, 2026, Day 8 validation passed: lint, application/shared-transport type checking, all 132 unit/integration tests, the production build, all ten Chromium browser regressions, and snapshot-fixture restart recovery. The persistence verifier now allows 20 seconds for service startup, pins its local development configuration, and cleans up a failed startup instead of leaving its child running.

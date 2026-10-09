# Presence event control

Day 9 keeps user identity, relative cursor/selection positions, active-file metadata, and online state in Yjs **Awareness**, separate from the durable Yjs source document. A non-null awareness state indicates presence; null indicates departure. `activeFile` is the current room's authorized file path. Presence is currently file-room scoped, not a project-wide participant directory.

## Network control

`PresenceWebsocketProvider` replaces the installed y-websocket awareness update listener. Only changes involving this client's own awareness ID may be sent. Received cursors, remote heartbeats, and remote removals are not rebroadcast as local presence.

The first movement sends immediately. Further events inside a 50 ms window share one trailing timer, encoding the latest local state when that timer fires. Sustained movement is limited to about 20 local presence messages per second, with one leading message at burst start. Intermediate cursor locations are discarded; document transactions are never delayed by this timer. The normal socket-open presence snapshot and Yjs heartbeats remain supported. This is client rate control, not enforcement against malicious clients.

Local removal bypasses the timer. Provider disconnect/destruction cancels queued movement and sends the installed provider's departure notification when the socket is usable. No queued cursor may resurrect a departed participant. Local state remains immediate, so editor movement does not wait on network scheduling.

## Cleanup and stale presence

The existing awareness expiry removes silent peers after 30 seconds, checked every three seconds while the event loop runs. Background browser timer suspension can extend wall-clock expiry; server-side awareness has the same expiry fallback. Explicit WebSocket close removes its controlled presence immediately without waiting for that timeout.

The installed upstream server only assigns newly added awareness IDs to connections. Day 8 reconnects reuse IDs, which arrive as updated states. The service now tracks added **and updated** IDs originating from each connection, so a reconnecting participant is also removed immediately on its next departure. This listener is removed when the socket closes. [Day 10 authorization](collaboration-authorization.md) checks active membership and roles; awareness-ID spoofing protection remains outside this implementation.

The installed y-monaco binding leaves its cursor-selection listener registered after destruction. The editor now owns that listener and the binding's remote cursor decorations through a small adapter. Binding destruction, model disposal, and effect cleanup dispose those resources idempotently. Other editor decorations are untouched. Day 8 still clears remote presence/clock caches during recovery and preserves one local document/awareness identity.

## Persistence boundary

Source updates alone trigger checkpoint writes and document Redis updates. Awareness uses its own WebSocket message kind and Redis pub/sub message kind. Pub/sub presence is transient: it is never added to the source document, checkpoint, or named history snapshot. The existing snapshot and history format is unchanged.

The persistence verifier now records checkpoint write count/state, emits 100 presence changes after a saved source edit, waits longer than the checkpoint debounce, and asserts no extra writes or changed checkpoint. It also checks restart-restored shared fields contain only the fixture's source content. This verifies the real service against a local HTTP snapshot fixture, not live MongoDB/Redis durability.

## Verification

Unit checks cover a 1,000-event burst, latest-selection delivery within 50 ms, immediate source edits, absence of remote echo, expired peer cleanup, immediate removal, canceled timers, Monaco cursor listeners/decorations, and awareness exclusion from encoded source state.

The real-socket recovery test sends 1,000 relative-position selection changes. It bounds received broadcasts using the actual burst duration and the 50 ms interval (a burst shorter than 50 ms allows at most four received frames across two clients), and checks final selection and active-file delivery. It checks unchanged durable Yjs state, repeated reconnect/departure cleanup, stable IDs, server restart, and terminal authentication failure. These are local correctness/traffic checks; a visual cursor latency study and larger client counts belong to Day 11.

Run `npm test`, `npm run verify:collaboration:persistence`, lint, type checking, the production build, and browser regressions. Live Redis and deployed-service validation remain deployment checks.

On October 5, 2026, Day 9 validation passed: all 137 unit/integration tests, lint, type checking, the production build, all ten Chromium browser regressions, and the checkpoint/presence persistence verifier. The final isolated presence/recovery recheck also passed; an earlier repeat under concurrent build load exceeded its server-startup deadline.

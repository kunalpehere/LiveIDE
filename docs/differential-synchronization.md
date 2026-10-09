# Differential document synchronization

Day 7 uses the installed Yjs 13 and y-websocket 1.5 synchronization engine inside the Day 6 versioned transport. No custom CRDT or replacement document format is introduced.

## Connection and recovery

1. The collaboration server hydrates the room from its checkpoint or canonical file before admitting a socket. If Redis delivered updates during hydration, the checkpoint is still merged into that document.
2. Both endpoints send sync step 1 (inner sync subtype 0), containing `Y.encodeStateVector(document)`. The vector records each Yjs client's known struct clock.
3. Each endpoint replies with sync step 2 (subtype 1): `Y.encodeStateAsUpdate(document, receivedStateVector)`. This contains missing structs and the delete set. Deletes must be exchanged even when struct state vectors match.
4. Further local transactions send their `update` event payload as subtype 2, rather than encoding the entire document.
5. Reconnection repeats the same handshake using the surviving client document. Edits made offline and edits received by the server while disconnected merge in both directions. Repeated application is idempotent.

An empty or restarted client can require the full document because it knows no existing structs. Delete sets may grow with editing history, so recovery is not guaranteed to be proportional only to recent edits. A provider's `synced` event means the server's step 2 was applied, not that all peers have acknowledged every concurrent transaction.

## Origins and initialization

The browser provider applies remote updates with itself as their transaction origin. Its installed update handler excludes that origin from local broadcasting. Monaco binds to the resulting shared text and does not insert the initial file content: the service owns initialization, and an empty shared text may represent an intentional complete deletion.

The upstream server broadcasts updates synchronously to all connections. The transport adapter suppresses only subtype-2 broadcasts to the socket whose incoming update is currently being applied. Other sockets still receive that update. State-vector responses, awareness, and updates from persistence/Redis remain eligible for delivery. The flag is cleared in `finally`, including failures. This suppression depends on the installed engine's synchronous update dispatch and is protected by the real-socket regression test.

Redis retains its existing instance/origin filtering. Durable HTTP checkpoints still encode the full Yjs document for restart recovery; these are separate from differential WebSocket traffic. This day does not change retry/backoff policy or add browser offline storage. Closing/reloading a tab can lose unacknowledged offline edits; those lifecycle concerns require separate work.

## Verification and measurements

Run `npm test -- tests/collaboration-wire.test.ts` and `npm run verify:collaboration:persistence`.

The wire test starts the actual collaboration process with BroadcastChannel disabled. It verifies independent concurrent editing, absence of server reflection and client echo, incremental live updates, offline edits in both directions, deletion recovery with matching state vectors, and repeated reconnection without duplicated text. The persistence check separately restarts the service against a local snapshot fixture.

Measured locally on October 5, 2026:

| Scenario | Bytes |
| --- | ---: |
| Full encoded Yjs state after a 64 KiB baseline | 65,602 |
| One-character live update application frame | 28 |
| Two recovery step-2 application frames combined, after independent edits and deletion | 77 |

Frame measurements include the five-byte LiveIDE envelope and inner sync framing; the full-state comparison is the encoded Yjs state alone. WebSocket/TCP overhead and awareness are excluded. Yjs client IDs can slightly change encoded lengths, so tests assert each incremental measurement is below 1% of full state rather than requiring exact byte counts. The fixture is a local two-client correctness/payload check, not a latency benchmark or a live Redis/deployment test. The broader performance suite is Day 11.

Day 7 validation passed: lint, application/shared-transport type checking, all 122 unit/integration tests, the production build, all ten Chromium browser regressions, and local snapshot-fixture restart recovery.

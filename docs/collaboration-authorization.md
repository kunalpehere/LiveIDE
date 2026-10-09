# Collaboration authorization lifecycle

Day 10 makes the application the authority for active collaboration access. The collaboration service uses the existing independent service secret to call `POST /api/collaboration/access`; this endpoint also verifies the user's signed token. Its exact proxy exemption does not grant public access.

## Roles and scoped tokens

Tokens bind protocol version, user, project, relative file path, room, collaboration revision, role, issue time, and expiry. The authenticated token endpoint derives role and revision from stored project access, never from client-supplied permissions. Tokens last ten minutes; the service rejects invalid signatures, expired tokens, incompatible versions, inconsistent rooms, wrong scopes, and lifetimes over ten minutes.

| Role | Scope | Realtime behavior |
| --- | --- | --- |
| Owner/editor | `collaboration:write` | Read, presence, and authorized document updates. |
| Viewer | `collaboration:read` | Read and presence; document uploads are forbidden. |

Viewer editors join collaboration with Monaco in read-only mode. Their state-vector request receives the server's missing content, but the server never requests their local document. Both sync step 2 uploads and ordinary Yjs update uploads are rejected before the room engine applies them. This also prevents a returning viewer from uploading cached content. BroadcastChannel shortcuts remain disabled.

## Active access checks

Before admission, and again after checkpoint loading, the service checks that the user and project still exist, the revision is current, and the role exactly matches the signed role. Every incoming document mutation receives another authoritative check before application. Checks share only an in-flight request; completed responses are not cached. Document mutations are serialized with a maximum of 32 pending writes per connection; presence and read requests do not fill this authorization queue.

Idle connections recheck access every five seconds after the preceding check completes. Each authority request has a two-second timeout. Membership removal, role changes, user/project deletion, and restore therefore also close idle connections. Network failure or an unavailable authority fails closed. Read/presence access can remain active until this bounded poll detects a change; a mutation checks access separately. A permission change occurring between a remote check and local Yjs application remains a distributed in-flight race; this design does not claim an atomic transaction across the application and collaboration process.

The socket also has a local expiry timer, and incoming frames check expiry. Expiry closes with 4001; the browser obtains a fresh token and reconnects using the same document. Revocation closes with 4003 (or 1008 when a write is rejected), revision invalidation with 4009, and authority failure with 1013. Revocation and revision changes stop automatic retries and require reopening/reloading the project. A changed role cannot rebind an existing editable document as a viewer. Temporary authority failures use Day 8's bounded retries.

Timers are cleared on socket close. Pending authorization cannot apply a frame after its socket closes. Logs use fixed error codes and request IDs rather than token contents or document payloads. Awareness-ID spoofing protection is not introduced by this milestone.

## Restore and checkpoint fencing

Snapshot reads reject a stale revision. A checkpoint write validates the revision inside a database transaction and conditionally writes the project document before upserting the checkpoint. The timestamp fence always changes the project document, including when two operations share a millisecond. Restore writes that same project document, increments the revision, creates the backup, replaces template content, deletes old collaboration checkpoints, and records history in one transaction.

Writing the shared project document prevents a read-only transaction snapshot from permitting an old-room insert alongside restore; competing MongoDB transactions must serialize or fail with a write conflict. See MongoDB's [transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) for stale reads and acquiring a document write lock. An aborted checkpoint is logged and can be retried by a later update; no automatic transaction retry is added here. Checkpoint writes now update project modification time and can contend across files of the same project.

Old sockets remain in their old revision's room until invalidation closes them. They cannot save over the restored revision because the snapshot API rejects stale writes. MongoDB transactions require a replica set. The development mock and HTTP fixtures do not prove rollback or database concurrency behavior.

## Verification and deployment checks

Unit tests cover viewer token scope, forged/expired credentials, current membership and roles, deleted users/projects, stale snapshot reads/writes, the conditional revision fence, and expiry-driven browser renewal. A real standalone-service socket test covers viewer synchronization, rejected viewer uploads, live revocation, idle role changes, active expiry, restored revisions, and authority outages.

Run lint, type checking, the full test suite, the production build, Playwright, and `npm run verify:collaboration:persistence`. The persistence verifier authenticates against a local authority fixture and checks restart recovery; it does not use production MongoDB or Redis. Live replica-set restore/checkpoint contention and rollback, distributed Redis convergence, and deployed-service access checks remain deployment verification.

Development-only collaboration test mode bypasses authoritative database calls; production configuration rejects that mode. Deploy the application and collaboration service together so the new access endpoint is available before admitting sessions.

On October 6, 2026, validation passed: lint, application and transport type checking, all 144 unit/integration tests, the production build, ten Chromium browser regressions, and local checkpoint restart recovery. After separating presence from the document authorization queue, the 20 affected protocol/session/socket tests and transport type check passed again; the restart verifier also confirmed that a 100-event presence burst stayed connected without changing the checkpoint. The first browser run timed out while the cold project was loading; all ten passed when the browser suite ran on its own. Live MongoDB/Redis deployment checks remain pending as described above.

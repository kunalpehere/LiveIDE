# Versioned collaboration protocol

## Shared contract

`lib/collaboration-protocol.mjs` is the runtime contract shared by the application, browser transport, collaboration process, and Redis relay. `lib/collaboration-protocol.ts` derives TypeScript client/server message types from these schemas. It does not maintain separate handwritten payload interfaces. Protocol version 1 is the only supported version.

`npm run typecheck` checks the application and then runs `typecheck:collaboration`. The latter checks the shared JavaScript contract and browser/server transport adapters with TypeScript `checkJs`. The existing standalone server and Redis orchestration remain JavaScript and consume those runtime validators; this change does not convert all server orchestration to TypeScript.

| Contract | Identity and validation |
| --- | --- |
| Token request | Protocol version, project ID, relative file path; client-supplied roles/revisions are rejected. |
| Signed token and token response | Version, project, file, revision, room, authorized role, and user metadata. The JWT also requires scope, issued-at, and expiry. |
| WebSocket session | The negotiated version and verified token bind every frame to one project revision and file. |
| Snapshot read/write | Version, project, file, revision, room; writes carry base64 state. Responses carry matching identity and either state or content; write acknowledgments carry the version. |
| Redis message | Version, project, file, revision, room, role, instance, message kind, and base64 payload. Parsed identity must match the subscribed channel. |
| Error response | Version and a fixed error code/message; no tokens, raw payloads, JWT details, or source contents. |

Revisions must be positive safe integers. File paths must be bounded, relative, slash-separated paths without empty segments, dot traversal, backslashes, or control characters. Room IDs retain the existing format: project ID, `.r`, revision, and a base64url UTF-8 file path. Contracts verify this mapping rather than trusting a caller's room string. No database migration or room renaming is required.

Roles are `OWNER`, `EDITOR`, and `VIEWER`. Owner/editor tokens carry write scope; viewer tokens carry read scope and cannot upload document updates. The token API derives the role and revision from stored project access. [Day 10 authorization](collaboration-authorization.md) adds active access checks, expiry-driven renewal, and restore invalidation.

## WebSocket framing

Clients offer the `liveide.collaboration.v1` WebSocket subprotocol. The server requires it before upgrading and verifies the signed token's version and room identity. Browser and server adapters wrap the installed y-websocket engine so it still sees its existing Yjs sync and awareness bytes.

Every WebSocket application frame is binary:

```text
"LIDE" (4 bytes) | protocol version (1 byte) | existing Yjs message
```

The complete frame is bounded to 1 MiB. The supported inner message kinds are sync (0, with sync subtypes 0/1/2), awareness (1), and the optional awareness query (3). The installed upstream server does not implement awareness-query replies. Control ping/pong frames stay under the WebSocket library's normal handling and are not wrapped.

Adapters reject text, missing magic/version, unknown kinds, truncated payloads, malformed state vectors/updates/awareness, and extra outer payload bytes before dispatching to the room engine. Yjs update validation uses the Yjs decoder already loaded by that runtime: ESM in the browser and CommonJS in the legacy standalone server. This avoids duplicate Yjs implementations and constructor-identity warnings.

Direct users of the frame/relay parsers must first call `configureYjsValidation(Y.decodeUpdate)` with their runtime's Yjs decoder. The browser adapter and standalone server initialize this automatically.

Project/file/role metadata is bound to the WebSocket session rather than repeated in every update. Day 10 rechecks current access before document mutations and on idle polling. State-vector handshakes and transaction origins are described in [differential synchronization](differential-synchronization.md), including Day 7 recovery checks and measurements. Browser BroadcastChannel shortcuts are disabled so every cross-tab update also passes through the versioned WebSocket boundary.

## Error behavior

| Code | Meaning |
| --- | --- |
| `VERSION_MISMATCH` | Unsupported/missing version or WebSocket subprotocol; HTTP 426 at negotiation. |
| `MALFORMED_MESSAGE` | Invalid shape, unsupported kind, encoding, or payload. |
| `ROOM_MISMATCH` | Project, revision, file, and room do not agree. |
| `FORBIDDEN` | Role cannot write. |
| `UNAUTHORIZED` | Missing, invalid, or expired authorization. |
| `UNAVAILABLE` | Required collaboration service or dependency is unavailable. |

Invalid frames close the socket with code 1002 and a fixed protocol error code as its reason. Oversized frames close with 1009 through the WebSocket library; the server handles the resulting error without terminating the process. HTTP handshake failures include a versioned JSON error and request ID. Browsers cannot read the failed WebSocket handshake body, so the editor supplies a general connection explanation in that case. Token negotiation and established-session protocol failures receive explicit explanations; fatal protocol failures stop that provider's connection attempts.

Snapshot requests bypass the browser-session redirect but remain protected by the dedicated collaboration secret inside the route. Wire-only metadata is not passed as extra fields to Prisma. Redis rejects malformed, incompatible, wrong-room, and invalid Yjs payloads before delivering them to a document. Distributed convergence still requires a real Redis deployment check.

## Compatibility and verification

This introduces the first explicit wire version and deliberately rejects unversioned tokens, snapshots, relay messages, and WebSocket frames. Deploy the application and collaboration service together, restart relay instances, and reload existing browser tabs. Existing stored room/state records remain usable; old tokens expire normally but do not satisfy the new version contract.

Run the normal lint, type checking, tests, build, and Playwright suite. The WebSocket integration test starts an isolated real collaboration process and verifies rejected legacy/version-mismatched handshakes, forbidden roles, inconsistent revisions, malformed/oversized frames, server-origin framing, and two-client convergence with BroadcastChannel disabled. Token/snapshot/Redis contract tests exercise the other boundaries.

`npm run verify:collaboration:persistence` starts local snapshot fixtures and a collaboration service, writes a document, restarts the service, and checks that it is restored using the versioned contracts. Its fixture is not a production MongoDB or Redis durability test. `verify:collaboration` remains available against an explicitly configured test collaboration service and now uses the versioned adapter too.

On October 5, 2026, lint, application type checking, the dedicated shared-contract/transport type check, and the production build passed. All 122 unit/integration tests and ten Chromium browser regressions passed. Real WebSocket tests confirmed two-client convergence, negotiation/frame rejection, and continued service operation after an oversized frame. Local restart recovery passed without duplicate Yjs module warnings. Live Redis convergence and coordinated deployed-service verification remain deployment checks.

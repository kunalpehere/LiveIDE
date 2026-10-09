# Shared runtime status — Day 19

The Shared runtime panel shows collaborators' process phases, development-server readiness, and a bounded diagnostic history. Every browser owns its own WebContainer. Runtime sharing remains active when the panel closes or the user switches to Notes. Viewers observe other browsers' runtimes without booting a local container or receiving terminal input controls.

## Shared data

The reserved `.liveide/runtime` channel carries ephemeral Yjs awareness at the current source revision. It never stores a document, hydrates a checkpoint, or saves runtime state. Source files, notes, and follow presence retain their existing channels. Identity and one awareness client ID are bound to the authenticated socket. Redis relays the same validated awareness when configured; document updates are forbidden for every role in this channel.

Only phase, readiness, host opt-in, a browser-session nonce, and up to 40 fixed diagnostic events are published. Install/development process output is projected into five categories: installation, readiness, warning, error, and output activity. Adjacent duplicate categories coalesce. No raw text, environment variables, credentials, command arguments, filenames, terminal escapes, or preview URLs enter the shared payload. This intentionally trades detailed remote logs for a strict privacy boundary; raw terminal output stays local. Classification indicates activity rather than authoritative process health. Preview readiness means a development server reported readiness, not that a remote browser loaded its iframe.

Publication is limited to once per 500 milliseconds for output/status bursts. A five-second heartbeat refreshes presence; announcements older than 30 seconds disappear. Disconnection clears remote controls and pending requests. Reconnecting requires the host to opt in again.

## Runtime controls

Owners and editors may explicitly enable **Allow editors to control my runtime**. It starts disabled. Other owners/editors can then request only these operations:

| Operation | Permitted host phase |
| --- | --- |
| Start | idle, stopped, failed |
| Stop | booting, mounting, installing, starting, ready |
| Restart | ready |

The authenticated `/api/collaboration/runtime-control` endpoint signs a request valid for 30 seconds. It binds the current project revision, requester, host user, client ID, session nonce, operation, and unique request ID. The host verifies the signature through the same endpoint, which checks current membership for both participants. Before execution the host also checks its opt-in, connection, phase, and live sender presence. Execution calls the existing fixed local runtime callbacks; there is no shared shell, argument input, filesystem operation, environment input, or arbitrary process spawn.

The host executes one remote operation at a time, ignores replayed request IDs, and publishes accepted/completed/rejected/failed acknowledgments. The requester cancels on host departure or disconnect, and times out after 150 seconds. Completion refers to the hosting callback finishing. Closing/reloading a browser ends its host session. Controls do not transfer between tabs. Viewer control requests are rejected by the API and awareness validator; viewer local run/restart/write/spawn paths are also gated.

Replay guards remain for 60 seconds, exceeding the signed request lifetime. The cache holds at most 1,000 IDs and refuses excess requests instead of evicting a still-valid guard.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test -- --maxWorkers=4`, and `npm run test:e2e:collaboration`. The security tests exercise secret projection, strict bounded payloads, forged identity, viewer advertisements, command injection, signatures, expiration, membership revocation, revision/client/nonce mismatch, and replay. Session tests cover host opt-in, sender departure during verification, failed verification, throttling, stale presence, and disconnect reset. Real sockets verify runtime announcements, forbidden editor/viewer document writes, malformed log rejection, and absence of checkpoint requests.

The Chromium collaboration scenario uses the authenticated collaboration server and development database fixture. It covers multiple browsers, panel switching, opt-in propagation, offline recovery, role changes, and viewer request rejection. WebContainer boot is deliberately gated in this deterministic scenario; actual engine startup remains covered by the existing runtime checks and requires a supported browser for manual verification. Real MongoDB persistence, Redis distribution, and deployment are not exercised by the Day 19 local fixture.

For a manual engine check, open the same project as two editors in supported isolated browser contexts. Start the host runtime, enable controls, then request stop, start, and restart from the peer. Observe acknowledgments and matching host phases. Produce local output containing arbitrary secret values and confirm that the peer receives only fixed diagnostic labels. Change the peer to Viewer and confirm that it can observe but cannot request operations or open a writable terminal.

Locally verified on October 7, 2026: the full Vitest suite passed 284 tests across 56 files. The subsequently added runtime socket test and two runtime checkpoint rejection cases passed separately, bringing the verified suite to 287 tests across 57 files. The final Day 19 security/session/socket/route/workspace selection passed all 20 tests, including replay-cache pressure, and the final connection-notice change passed its session tests. Lint, application TypeScript checks, collaboration type checks, and a clean production build passed. Follow, Notes, and Shared runtime Chromium scenarios passed; the final Day 19 rerun had no page errors. Its viewer screenshot was inspected, and temporary test listeners stopped. No live database rollout, commit, push, or deployment was performed.

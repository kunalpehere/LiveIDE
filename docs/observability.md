# Observability and health

## Request and error correlation

Application responses passing through Proxy carry `x-request-id`. A valid UUID supplied by a caller is preserved so service calls can share an ID; invalid values are replaced. IDs are diagnostic metadata, never authorization or proof of identity. Proxy forwards the ID to the renderer and route handlers. The HTML document includes its request ID in `meta[name="liveide-request-id"]`.

Application API handlers (chat, suggestions, templates, collaboration, health, and monitoring) log status, method, route pattern, duration, and request ID. Their exception wrapper returns a generic error with the same ID in its header and body. Handler-specific errors keep their existing public response contract and have a correlated completion/failure log. Server-action failures also include `requestId` in their result. AsyncLocalStorage keeps IDs separate across concurrent API requests and actions.

Next.js `onRequestError` captures uncaught render, route, action, and proxy errors. It records route patterns and a numeric React digest when available. Authentication responses carry Proxy's ID, but Auth.js owns their handler logs. Static assets excluded by the Proxy matcher do not receive application request IDs. Stream completion errors may occur after a successful response header; request duration measures handler completion, not the entire stream.

## Browser and runtime monitoring

Client instrumentation reports global errors and unhandled promise rejections. Route and root error boundaries report React failures. WebContainer boot/setup failures report their runtime phase. Reports go to the application's own `/api/monitoring` endpoint and enter the same structured server log stream; no external SDK, account, cloud integration, or credentials are required.

Each report carries an event UUID, its source, and the original document's request UUID when available. A numeric React digest can link the browser boundary to the server failure. The monitoring POST has its own request ID. Reports deliberately omit raw messages, stacks, user identities, project contents, filenames, query strings, cookies, and tokens. This protects privacy but limits diagnosis to categories, phases, stable application error codes, and digests.

Reporting is best effort: transport failures do not interrupt the editor, identical error objects are deduplicated, and a tab submits at most 20 reports per minute. Ingestion requires a matching Origin, strict metadata validation, and at most 1 KiB, including requests without Content-Length. A process accepts at most 1,000 reports per minute. This is a bounded local safeguard, not distributed abuse protection. Client reports remain untrusted diagnostic signals.

Logs are JSON on stdout/stderr with an allowlist of fields. Arbitrary context and raw Error messages/stacks are discarded in all environments. Collaboration startup, Redis relay, persistence, and rejected connection failures use this logger. Configuration validation prints only its existing fixed setting-name explanations. Next.js automatic development logging is disabled because it can forward raw browser errors, URL queries, and server-action arguments. Browser developer tools and other platform/framework logs outside this logger may still have their own format and retention policy.

## Health endpoints

Health endpoints are public, read-only, do not redirect to sign-in, return `Cache-Control: no-store`, and expose only statuses and fixed codes. They never return credentials, dependency URLs, instance identifiers, or exception details.

| Endpoint | Purpose |
| --- | --- |
| Application `/api/health/live` | Process liveness; returns 200 without dependency checks. |
| Application `/api/health/storage` | MongoDB readiness only; used by collaboration to avoid recursive checks. |
| Application `/api/health` | MongoDB and optional collaboration readiness. |
| Collaboration `/healthz` (also `/`) | Collaboration process liveness. |
| Collaboration `/readyz` | Required storage service and configured Redis connections. |

MongoDB is probed with a real ping. Production storage failure gives application status `unavailable` and HTTP 503. The development mock is explicitly `degraded`, never mistaken for healthy MongoDB. Optional collaboration failure gives application status `degraded` with HTTP 200: editing/storage remain usable. Unconfigured collaboration is `disabled`. Healthy required dependencies with optional services disabled give `healthy`.

Collaboration checks the app's storage endpoint and both Redis connection readiness flags when Redis is configured. Loss of either required dependency gives HTTP 503. Without Redis, the single-process relay remains supported. Development collaboration test mode skips storage and reports `degraded`. Health reflects Redis connection state, not a durability or data-convergence guarantee. Redis startup connection attempts are bounded; failed or lost connections require restarting the service with this configuration.

Probes have a two-second response deadline and results are cached/coalesced for five seconds per process. An outstanding MongoDB driver operation is reused until it settles, preventing overlapping pings after timeouts; the HTTP deadline does not cancel Prisma's underlying operation. Collaboration fetches use abort deadlines. Configure `COLLABORATION_APP_URL` to the application origin. The WebSocket public base URL must also expose its base path plus `/readyz`; configure the reverse proxy accordingly.

## Using the evidence

Use the response's `x-request-id` (or a failed server-action result's `requestId`) to find the matching log entries. Browser reports can also be searched by event ID, page request ID, or React digest. Use liveness for restart decisions and readiness for traffic admission; a healthy live endpoint alone does not prove a usable database.

Deployment platforms can collect the JSON log stream. Retention, alerts, a durable error dashboard, and any external monitoring provider still require deployment configuration; this implementation does not claim to provide those services.

## Verification

Run lint, type checking, unit/integration tests, a production build, and the Playwright suite. Tests cover a deliberate correlated exception, concurrent request isolation, omitted secret material, monitoring ingestion controls, healthy/degraded/unavailable states, probe timeouts, and a real collaboration HTTP readiness failure. Browser checks cover anonymous health access and delivery of a browser failure without its private contents.

On October 5, 2026, lint, type checking, and the production build passed. All 110 unit/integration tests and the full ten-test Chromium suite passed. After disabling automatic framework development logging, the four affected observability/production browser tests were rerun and passed. The browser failure reached the structured log without its raw message being forwarded to the development terminal. Production health used real database probes with mock mode disabled; live cloud alerts, log retention, and deployed dependency checks remain deployment configuration work.

# Vercel deployment

## Status

Day 28 is in progress. Vercel CLI browser authorization succeeded on October 8,
2026. Project `kunal-pehere/liveide` was created and linked to this workspace.
The CLI downloaded its managed OIDC token into the ignored `.env.local` file.
The 47 focused configuration, browser security, authentication routing,
and observability tests passed. Preview `DATABASE_URL` and generated
`AUTH_SECRET` are configured, with mock/test/AI modes disabled and trusted-host
authentication enabled. Atlas preview network access is temporarily open for
six hours; this is not a durable production network configuration.

The first CLI upload was assigned to Production despite requesting Preview.
Its build failed because production authentication settings were absent. The
CLI documents special first-deployment production assignment; the subsequent
upload was correctly classified as Preview and reached Ready. Its stable alias
is `https://liveide-preview-kunal-pehere.vercel.app`. Reassign that alias to
subsequent preview deployments; OAuth callbacks use this stable hostname.
Do not copy preview secrets into Production to bypass that failure.

The upload manifest excludes environment files, local logs, reports, and
generated output via `.vercelignore`. Node.js 22.x is specified in the package
manifest to match local and CI verification. No deployment has yet passed all
Day 28 acceptance checks. The deployed `/api/health` returned HTTP 200 with
real MongoDB `healthy` / `READY` and collaboration disabled, as intended before
Day 29. Response headers included no-store, COOP/COEP, nonce-based CSP, HSTS,
and a request ID. The CLI generated a project-scoped deployment-protection
bypass token for its health request; browser access remains protected.
GitHub preview credentials and stable `AUTH_URL` are configured. The rebuilt
preview reached Ready and the stable alias was updated. `/api/auth/providers`
exposes only GitHub with the registered stable callback; guest authentication
is absent. MongoDB readiness remains healthy. The owner reported successful
GitHub sign-in. Independently recorded authenticated persistence, browser runtime checks, monitoring, and production
configuration are still pending.

## Project settings

Use the repository root, the Next.js framework preset, Node.js 22.x, and the
committed npm lockfile. `vercel.json` generates the Prisma client before the
normal build, matching CI. Security headers remain in Next.js configuration.
Do not deploy as a static export: authentication, database access, actions, and
health endpoints require the server runtime.

## Preview credentials

Use a separate database named `liveide_preview` and a database user with
read/write privileges on that database. In Atlas, configure database access
and network access, then obtain the Drivers connection string. Include
`/liveide_preview` before the query string and URL-encode password characters.
Keep the URI in Vercel's Preview environment settings, never in Git or chat.
Initialize the preview database indexes using Prisma against that database
only; do not run schema changes against the existing production database.

Configure at least one OAuth provider. For GitHub, create a separate OAuth app
with callback `<verified-preview-origin>/api/auth/callback/github` and homepage
`<verified-preview-origin>`. Use a stable preview URL and update callbacks when
the URL changes. Production requires its own matching provider configuration.

| Variable | Preview setting |
| --- | --- |
| `DATABASE_URL` | Preview MongoDB URI |
| `AUTH_SECRET` | Fresh random secret, at least 32 characters |
| `AUTH_URL` | `https://liveide-preview-kunal-pehere.vercel.app` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Preview GitHub OAuth app credentials |
| `AUTH_TRUST_HOST` | `true` for the trusted Vercel deployment |
| `ENABLE_MOCK_DB` | `false` |
| `COLLABORATION_TEST_MODE` | `false` |
| `AI_ENABLED` | `false` until a reachable provider is configured |
| `NEXT_PUBLIC_COLLABORATION_URL` | Unset until the Day 29 secure service exists |

Do not copy the local `.env.local` wholesale: localhost services cannot be
reached from Vercel. Leave the legacy secret alias unset or match `AUTH_SECRET`.
Let Vercel set `NODE_ENV`. Avoid pinning authentication URLs to localhost or
the existing Netlify origin. Configure repository integration separately if
it is required; it uses a different GitHub OAuth app and encryption key.

## Acceptance evidence still required

- Preview build succeeds from a fresh dependency installation.
- Health liveness returns 200; storage readiness confirms real MongoDB.
- Deployed security headers and document request IDs are correct.
- Guest authentication is unavailable; real OAuth works and protected routes
  enforce authentication.
- Project create/save/reopen works in the preview database.
- Browser reports reach structured deployment logs without private content.
- WebContainers boot, terminal commands run, and previews render in a supported
  browser with cross-origin isolation enabled.
- Production environment settings, callbacks, log retention, and monitoring
  are configured and verified separately.

A preview deployment is not evidence that production is ready. Keep the
current Netlify deployment available until the Vercel checks are complete.

# Runtime configuration and production safety

`lib/runtime-config.mjs` provides Zod-validated configuration shared by Next.js and the Node.js collaboration service. TypeScript callers receive inferred field types. Errors name invalid settings without including their values.

Next.js validates application configuration in `instrumentation.ts` before its Node server handles requests. Authentication and database modules also validate when initialized. The collaboration service validates before listening. Restart the relevant process after changing configuration. `NEXT_PUBLIC_COLLABORATION_URL` is embedded into the browser bundle at build time, so changing it requires rebuilding the app.

## Required settings

| Setting | Requirement |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`; plain Node scripts default to development when unset |
| `DATABASE_URL` | MongoDB URI with a database name, required unless explicitly using development mock mode |
| `AUTH_SECRET` | Required for the app; `NEXTAUTH_SECRET` is accepted as a legacy alias; both must match when supplied |
| `ENABLE_MOCK_DB` | Exactly `true` or `false`; allowed only in development; guest sign-in uses the same development-only gate |
| OAuth provider ID/secret | Configure each pair together; providers are optional for build verification |
| `NEXT_PUBLIC_COLLABORATION_URL` | Empty disables browser collaboration; otherwise `ws://` or `wss://`, with `wss://` required in production |
| `COLLABORATION_SECRET` | Required when browser collaboration is enabled or the collaboration service runs; must differ from both auth-secret aliases |
| `COLLABORATION_APP_URL` | Required by the production collaboration service; must use `https://` in production |
| `COLLABORATION_PORT` | Integer from 1 to 65535; defaults to 1234 |
| `COLLABORATION_TEST_MODE` | Exactly `true` or `false`; forbidden in production because it bypasses durable room initialization |
| `REDIS_URL` | Optional `redis://` or `rediss://` URL; empty means no Redis relay |

Production authentication and collaboration secrets require at least 32 characters. Known placeholders and trivial repeated values are rejected. These checks cannot prove randomness: generate independent secrets rather than inventing passwords. MongoDB settings must not contain placeholder credentials or explicitly disable TLS in production. URI validation does not establish database connectivity.

Generate each secret separately:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep generated values in local environment files or deployment secret settings, never in Git. The CI workflow's public fixtures are only for build checks; they must never be used for a public deployment.

## Local development

Copy `.env.example` to `.env.local`, replace the authentication secret and its alias with the same generated value, then either configure MongoDB or set `ENABLE_MOCK_DB=true`. Guest sign-in is available only in explicit development mock mode.

To enable local collaboration, set `NEXT_PUBLIC_COLLABORATION_URL=ws://localhost:1234`, generate a separate `COLLABORATION_SECRET`, and supply that same secret to the application and collaboration process. Authentication-secret fallback has been removed everywhere, including the internal checkpoint endpoint.

Next.js loads `.env.local` itself. The standalone collaboration command does not automatically load Next.js environment files. On Node.js 22, launch it with the same local settings using:

```bash
node --env-file=.env.local scripts/collaboration-server.mjs
```

Alternatively, supply settings through the shell or service host. `npm run dev:collaboration` requires the collaboration settings to be available in its shell environment.

## Production preparation

Disable mock and collaboration test modes, configure MongoDB, generate independent secrets, and use secure collaboration URLs. Configure real OAuth providers before exposing sign-in publicly. Production builds must also receive valid settings; the validator intentionally does not skip production invariants during builds.

Day 3 adds these configuration safeguards. Browser headers, trusted origins, rate limits, token revocation, monitoring, and deployment verification remain in their respective roadmap milestones.

## Day 3 verification

Verified locally on October 5, 2026: lint, type checking, production build with explicit build settings, and all four Chromium smoke tests passed. The full regression run passed 92 tests; subsequent focused runs passed all 29 configuration tests (including the added replica-set URI case) and three subprocess startup tests. Invalid service settings exit before listening, and validation errors do not include supplied credential values. Existing local development settings also passed validation.

The updated GitHub Actions workflow has not yet been run remotely. No cloud deployment is part of Day 3.

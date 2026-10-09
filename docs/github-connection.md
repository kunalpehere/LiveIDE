# GitHub connection security — Day 20

Day 20 adds repository authorization at **Projects → Connect GitHub**. Day 21 adds the [repository browser](github-repository-browser.md), Day 22 adds [imports](github-repository-import.md), and Day 23 adds [explicit write consent and reviewed commits](github-review-and-commit.md). GitHub identity-provider sign-in is independent: disconnecting repository access does not sign the user out or remove the sign-in account.

## Permissions

Public access is the default and requests an explicitly empty OAuth scope. Public repository reads need no repository scope. Private access is an explicit radio choice and requests only `repo`. GitHub OAuth has no read-only private-code scope: `repo` includes broad write access across accessible repositories. LiveIDE explains this before authorization; no repository mutations are implemented in Day 20. Organization policies and SSO can still restrict access.

Day 23 keeps those defaults and adds an unchecked **Enable commits** choice. Public write consent requests `public_repo`; private writes still use `repo`. Stored write consent is required independently of granted scope, and each publication requires confirmation of reviewed changes. See the Day 23 guide for owner access, recovery and workflow restrictions.

Both the token exchange and `/user` response scopes must match the selected access. Unexpected or previously accumulated scopes fail closed and the newly exchanged token is revoked where possible. To reduce access after a private grant, remove the repository app under GitHub's authorized apps settings, then reconnect with public access. A GitHub App is the future alternative for repository selection and finer permissions.

## Configuration and database rollout

Create a **separate GitHub OAuth app** for repository access; do not reuse the sign-in app. Register its callback as `<origin>/api/github/callback`. Keep all four settings server-only:

| Setting | Value |
| --- | --- |
| `GITHUB_CONNECTION_CLIENT_ID` | Repository OAuth app client ID |
| `GITHUB_CONNECTION_CLIENT_SECRET` | Its client secret |
| `GITHUB_CONNECTION_ORIGIN` | Canonical HTTPS app origin, without trailing slash; HTTP localhost/127.0.0.1 is allowed outside production |
| `GITHUB_CONNECTION_ENCRYPTION_KEY` | Independent random 32-byte key encoded as 64 hex characters |

Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Store it in the deployment secret manager. Missing/invalid settings disable authorization and show an administrator message. Preserve the canonical origin if disabling credentials so same-origin disconnect remains available.

Regenerate Prisma with `npm run prisma:generate`. The new `GitHubConnection` collection has a unique user index and a cascading user relation. Review and apply `npm run db:push` against the intended real MongoDB database before enabling the connection. The implementation does not automatically push a schema or modify `.env.local`. Development mock records are in memory and disappear on restart.

Keep the encryption key with protected backups; losing/changing it makes existing credentials unreadable. For this initial single-key format, disconnect/revoke existing connections before rotating the key or changing the OAuth app, then reconnect. Never copy tokens into project templates, source files, snapshots, notes or runtime configuration.

## Security boundaries

- Authorization begins with an authenticated, same-origin POST. Requested access is strictly validated; clients cannot supply a user ID or callback URL.
- State and PKCE verifier are random 32-byte values. State is hashed in MongoDB; the verifier is encrypted. An HttpOnly, SameSite=Lax cookie binds the callback to the initiating browser, valid for ten minutes and Secure on HTTPS.
- The callback requires the same LiveIDE user, matching cookie/state and an unexpired persisted attempt. Conditional database updates consume state exactly once. New attempts supersede old tabs; disconnect changes the attempt version, preventing an in-flight exchange from restoring access.
- Tokens and verifiers use AES-256-GCM with fresh IVs and authenticated user/purpose context. Ciphertext cannot be moved between users or reused as another credential type.
- Provider calls run only on the server, use fixed HTTPS endpoints, no-store, ten-second timeouts and reject redirects. Browser responses contain only the authorization URL or an explicit status projection, never provider credentials or provider error bodies. Callback redirects use fixed destinations and no-referrer headers.
- Credential-bearing auth account lookup server actions were removed. JWT/session construction reads only user identity fields directly on the server.
- Status refresh validates the token with GitHub. Unauthorized responses or mismatched identity/permissions clear stored access; outages and rate limits show unavailable without destroying a potentially valid connection. No refresh loop or repository browser is introduced.
- Disconnect requires same-origin DELETE and a deliberate UI confirmation. It removes local credentials and pending attempts first, then revokes the provider token. If GitHub is unavailable, LiveIDE remains disconnected and explicitly directs the user to remove the repository app in GitHub settings. There is no durable provider-revocation retry queue in this milestone.
- Reauthorization revokes a replaced token after successful storage, unless GitHub returned the same token. Failed revocation is reported in the callback outcome. Disconnect also compares the credential it read, so a concurrent token replacement must be retried instead of being silently removed without revocation.

## Verification

`tests/github-connection.test.ts` exercises configuration, authenticated encryption, scope minimization, private consent, callback replay/expiry/cancellation, concurrent consumption, disconnect during exchange, provider revocation and transient failure. `tests/github-routes.test.ts` checks authenticated APIs, same-origin guards, browser binding, cookies, fixed redirects and token-free payloads. Panel tests check default consent, disconnect confirmation and failure messaging. The Chromium scenario covers the real protected dashboard and safe unconfigured state.

Provider exchanges are mocked in automated security tests. A real OAuth round trip, GitHub-side token revocation, organization restrictions and the new unique index on live MongoDB require configured credentials and a database rollout. These must be verified before production enablement.

### Local verification record — October 7, 2026

- Full Vitest suite: 310 tests across 60 files passed with `--maxWorkers=4`. The initial unrestricted run hit five collaboration startup/convergence deadlines; all five passed in the bounded run.
- Three additional lifecycle race/cleanup cases were added afterward. The final focused run passed 31 checks (25 GitHub checks plus six authentication-routing checks), bringing the verified suite to 313 tests across 60 files. A single full 313-test run was not performed.
- Lint, application TypeScript checks, collaboration TypeScript checks, Prisma client generation and the production build passed. The build used process-only public fixture settings without editing `.env.local`.
- The new Chromium scenario passed authenticated navigation, protected APIs, no-store status, public consent default, disabled configuration messaging and zero page errors. Live GitHub authorization was not performed.
- No commit, push, deployment or live database schema push was performed. Earlier uncommitted work was preserved.

Provider references: [OAuth web flow and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [token revocation](https://docs.github.com/en/rest/apps/oauth-applications).

# Invitation lifecycle — Day 17

Project owners can open **Share**, select **Viewer** or **Editor** under **Invitation links**, choose an expiry of one hour, one day, or seven days, and click **Create invitation**. Copy the generated link before closing Share: its secret is only returned once. Anyone holding the link can sign in and explicitly accept it. Links are single-use, and viewing a landing page never grants membership.

The existing email flow is now labelled **Add member**. It still grants access immediately to an existing LiveIDE user. Owner-only member role changes and removal remain available. Acceptance preserves an existing member's current role, so a link cannot silently upgrade or downgrade that membership. The project owner cannot consume their own invitation.

Share lists the latest 100 invitation records as pending, used, expired, or revoked. It refreshes those states every 30 seconds while open. Owners can revoke pending links. Revoking a link does not remove an accepted member; use member removal to end that access. Existing collaboration membership checks continue to disconnect revoked or changed memberships, including follow mode, within the authorization watcher's polling interval.

Anonymous visitors see a sign-in link and return to the invitation after authentication. Sign-in return destinations are restricted to valid local invitation paths. Invalid, expired, used, and revoked links show clear explanations. The server checks current state again on acceptance, including when a page was opened before expiry or revocation.

## Persistence and concurrency

`PlaygroundInvitation` stores a SHA-256 hash of a cryptographically random 256-bit token, the project, selected role, creator, expiry, revocation timestamp, and acceptance identity/timestamp. Plaintext secrets are not stored, listed, or logged by actions. Invitation pages send `Referrer-Policy: no-referrer`.

Acceptance conditionally claims an unused, unrevoked, unexpired record and creates membership in the same Prisma transaction. MongoDB write conflicts roll back the transaction and are retried up to three times; a losing acceptance rechecks the invitation state. A failed membership write leaves the invitation usable. Unique token-hash and project/user membership indexes enforce identities. Nullable lifecycle fields are explicitly initialized to null to match MongoDB's conditional filters. The development mock serializes transactions and rolls back invitation/member changes on failure.

Every management action independently requires the project owner. Inspection and acceptance require authentication. Editor and viewer accounts cannot create, list management records, or revoke links. Tokens do not confer owner access.

## Database setup and verification

Locally verified on October 7, 2026: lint, application/transport type checks, and production build passed. The full unit suite passed 257 tests across 49 files; the finalized 16-test invitation suite also passed, including an additional stale-claim revocation regression. Six invitation/sharing/history browser scenarios passed. The separate real collaboration scenario also passed with a viewer joining through an invitation link, following collaborators, and losing active access after membership removal. Browser scenarios reported no page errors. The Share dialog screenshot was visually inspected.

The local Prisma client was regenerated. Before enabling this feature against a real MongoDB deployment, apply the updated Prisma schema and indexes using the project's normal database rollout (`npm run db:push`), then regenerate the client during deployment. MongoDB must support transactions, as already required by project history operations. This implementation does not modify a live database or deploy the app.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. The browser lifecycle tests run in the normal Playwright suite, or separately with:

```bash
npx playwright test e2e/invitation-lifecycle.spec.ts --project chromium
```

Unit coverage includes both roles, expiry boundaries, revocation scoped to a project, unauthorized management, authentication, malformed tokens, existing memberships, simultaneous acceptance, rollback, and transaction-conflict recovery. Browser coverage exercises owner creation, recipient acceptance with actual editor permissions, used/revoked states, member removal, and sign-in return. The separate collaborator-follow browser scenario checks active collaboration access removal. Live MongoDB transaction races and hosted CI remain deployment verification tasks.

# Day 23 — Review and commit GitHub changes

## Workflow

On **GitHub connection**, select public/private access, check **Enable commits**, and reconnect. Public writes request `public_repo`; private access requests `repo`. Existing connections remain browse/import-only in LiveIDE until this separate choice is made, even when a private token already has broad provider permissions. OAuth write scope covers repositories your GitHub account can write; every publication still needs confirmation.

Open an imported project, save edits, and choose **GitHub changes** (`/playground/{id}/github`). Only the project owner can review and publish. Enter a message and optionally a new branch name; a blank name generates `codex/liveide-…`. **Review saved changes** shows additions, modifications and deletions, highlighted line diffs, and complete before/after text. Diff computation is bounded; large changes retain the complete comparison. All source text is escaped.

Inspect the repository, source commit, new destination branch, message and exact changes. Check the confirmation box and choose **Confirm and publish new branch**. Review alone never mutates GitHub. Existing branches are never updated, force-pushed or deleted. Success links the commit/branch and advances the source baseline to the new branch; local project content stays unchanged.

## Comparison and validation

Review uses Day 22's versioned source baseline and fetches the current source branch/tree. It verifies numeric repository identity, private consent, explicit commit consent and repository push permission. Archived/disabled repositories are refused. Only imported baseline files become deletion candidates. Remote/omitted entries colliding with new local files are conflicts.

Remote changes to managed files block publication unless local content already matches the current remote blob. Resolve against current source or import the updated source before reviewing again; there is no automatic three-way merge. An advanced branch can be reviewed when managed files remain unchanged. Changes outside the managed files are inherited from the latest reviewed tree.

Publishing patches the **root base tree**, mapping local paths beneath the original folder. Other folders and omitted binary assets, symlinks, submodules and LFS entries are preserved. Imported executable modes are retained; additions use regular file mode. Omitted assets are never treated as deletions.

Saved snapshots enforce import limits: 250 files, 256 KiB/file, 2 MiB raw/serialized UTF-8 and 20 folder levels. Unsafe paths, case/Unicode collisions, invalid UTF-8 round-trips, binary controls and LFS pointers fail before writes. Source manifests are bounded to 1,000 entries and 2 MiB provider responses; truncation fails. Changes under `.github/workflows/` are refused because this app never requests the additional workflow permission.

The durable review binds the saved version/content hash, baseline, source head, message, branch and author. Reviews expire in 15 minutes. Changed saved content or authorization invalidates an unconfirmed review. Head is checked before object creation and before publication. GitHub cannot atomically compare an independent source reference when creating a new reference: a concurrent source advance may leave the new branch based on the exact reviewed commit, but cannot overwrite the source branch.

## Recovery

`GitHubCommitOperation` stores the immutable snapshot, per-file upload cursor, tree/commit checkpoints, status and lease. A short transaction claims a project lock and worker lease before writes. Calls have 10-second timeouts, an operation has a 120-second deadline, and leases last 180 seconds. Workers recheck authorization and lease ownership before writes. Expired workers carry an aborted deadline. Large interrupted uploads resume from completed files; they do not need to upload the entire snapshot again.

The sequence creates and verifies content-addressed blobs, patches the tree, creates a commit with persisted author/committer/date/message/parent, creates the new branch directly at that commit, verifies its reference, and atomically saves the baseline and success status. No empty branch is published. Fixed Git object inputs make ambiguous object-creation retries reproduce the same identity; recorded checkpoints are reused.

Failures retain progress as **RECOVERABLE**. Lost reference responses are reconciled by reading the new branch. A branch pointing to another commit blocks recovery. If publication succeeded but baseline persistence failed, recovery verifies the branch and completes the local transaction. Successful retries return the existing result without provider writes.

Refresh/reload exposes **Recover confirmed commit**, with its own confirmation. Recovery uses the previously approved snapshot and preserves later local edits. Reauthorization requires the original GitHub account with commits enabled. Rate-limit cooldowns are shared with browsing; there is no automatic mutation retry loop.

An owner can explicitly **Abandon unpublished operation** after the worker lease ends. The service verifies repository identity and that the recorded commit has not been published, then releases the local lock. It never deletes GitHub objects or branches. A published commit must be recovered. Unreachable objects from abandonment remain under GitHub's normal object lifecycle. Pending operations block project deletion so recovery records cannot disappear during publication.

## API and rollout

`GET /api/github/commit?projectId=…` returns owner-only source/status summaries with no-store headers. Strict same-origin authenticated JSON POST actions are `review`, `publish` and `cancel`, with streaming bodies bounded to 4 KiB. Publication/abandonment require literal `confirm: true`. Clients cannot supply provider URLs, file content, source SHAs or arbitrary paths.

The provider client allows POST only to fixed Git blob/tree/commit/ref endpoints. It verifies explicit write consent, exact scopes, token identity, revocation/current connection, provider origin, bounded responses and rate limits. No PATCH/force-update/delete-reference operation exists. OAuth write consent uses the existing separate app, encrypted storage, PKCE, state and canonical origin; pending consent is bound to the attempt and cleared on callback/disconnect.

Regenerate Prisma and apply the reviewed schema through the established MongoDB rollout before deployment. Connection fields default to commits disabled; Playground gains an optional commit lock; the new operation collection stores recovery records. Transactions require Atlas/a replica set. No new environment variables are needed. Restart the development mock server after upgrade because its delegate cache version changes.

API tests use real routes/services, deterministic provider responses with real blob hashes, failure injection and the mock database. Panel tests cover confirmation, escaped diffs and recovery. Chromium uses authenticated local navigation with intercepted commit responses; it does not publish to GitHub. Live OAuth write consent, repository/organization rules and MongoDB persistence need configured services and a separately confirmed test publication.

No live GitHub mutation, schema push, repository commit/push or deployment is performed during local implementation. Day 24 resource limits remain a separate milestone.

Provider references: [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [Git blobs](https://docs.github.com/en/rest/git/blobs), [Git trees](https://docs.github.com/en/rest/git/trees), [Git commits](https://docs.github.com/en/rest/git/commits), [Git references](https://docs.github.com/en/rest/git/refs).

### Local verification record — October 7, 2026

- Full Vitest suite passed **403 tests across 66 files**, including 30 commit API/service cases and four commit/diff panel cases. The final run used `node node_modules/vitest/vitest.mjs run --maxWorkers 2`. An earlier run found an older authorization fixture missing the new deletion transaction; the fixture was updated and its targeted and full checks passed.
- After the full run, targeted commit tests passed again for exact-content collisions with omitted assets; panel tests passed after updating the displayed source label on successful publication.
- Prisma client generation, full project lint, application/collaboration TypeScript checks and the final production build passed. Builds used process-only public fixtures without modifying `.env.local` or contacting production services.
- All **five GitHub Chromium scenarios passed**, including explicit confirmation, escaped highlighted diffs and recovery after reload, plus existing connection/import/cooldown behavior. The review screenshot was visually inspected. Browser responses were intercepted; API tests separately verify persistence and injected failure recovery.
- No live OAuth/write verification, schema push, GitHub mutation, repository commit/push or deployment was performed. Earlier uncommitted work was preserved, and browser test servers released ports 3100/3200.

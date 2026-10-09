# Day 22 — GitHub repository import

Connect GitHub using the Day 20 setup, then open **Dashboard → GitHub repositories**, choose a repository and branch, and click **Review import**. At the root this imports the repository; inside a folder it imports that folder relative to the new project root. Enter a project name before reviewing. Review shows the supported file count, bytes, detected template, pinned commit and every omitted entry. Confirm omissions explicitly, then choose **Create imported project**. The resulting link opens the new project; importing itself never runs repository code.

## Validation and limits

- Imports use authenticated server-side GETs to [Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree) and [Git blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob), with the same encrypted-token, scope, private-consent and cooldown checks as browsing. Provider URLs, tokens and arbitrary client file trees are never accepted.
- Signed browser navigation now retains the branch commit SHA and root tree SHA through folder navigation. Import reads that immutable selected tree, even if the branch moves afterward. Refresh the branch to select a newer commit. Previously issued browser references without this metadata require reselection.
- The recursive source manifest is bounded to 1,000 entries and a 2 MiB provider response. Truncated trees fail; no partial manifest is imported. At most four blobs are fetched concurrently, with 10-second provider timeouts and a 120-second overall deadline per review/create request.
- Limits match project storage: 250 supported text candidates, 256 KiB per file, 2 MiB total candidate bytes, 20 folder levels, and 2 MiB for the final UTF-8 serialized project including JSON overhead. Oversized or unknown-size regular files fail, even if their format would otherwise be omitted. Large repositories should import a smaller folder.
- Reject absolute/traversal/control/separator paths, reserved `.git`/`.liveide` segments, Windows reserved characters/device names, trailing dots/spaces, duplicate paths, Unicode-normalized/case collisions, conflicting files/directories, and missing or mismatched parent folders. No repository archive extraction or filesystem writes are used.
- Supported source/config/document types follow the browser allowlist. Symlinks, submodules, unsupported formats, binary/invalid UTF-8 content and Git LFS pointers are listed as omissions and require explicit consent. Git LFS assets are not fetched. Missing assets may prevent a project from running. An empty supported import fails.
- Blobs must match declared size and SHA, and the Git SHA-1 is recomputed over original bytes. UTF-8 BOMs, empty text, executable mode metadata, dotfiles, tracked configuration and lockfiles are preserved. No starter files replace imported contents.
- The template label is detected from root package.json dependencies (Next, Vue, Angular, Hono, Express; React fallback). It does not change source or guarantee runtime compatibility for every repository/language.

## Persistence and retry behavior

`POST /api/github/import` requires a signed-in session, configured same-origin JSON requests, strict inputs and a streamed body bounded to 20,000 bytes. `review` performs no database project writes and returns a user/connection-bound signed plan valid for 15 minutes. `create` recomputes and validates the pinned source, checks its reviewed digest, and enforces omission consent. It creates a fresh project, source baseline and saved template content in one short MongoDB transaction, after all GitHub reads complete. Authorization is checked and locked by connection version inside that transaction. MongoDB must support transactions (replica set/Atlas), as documented for existing project operations.

The signed plan's random project ID is a durable idempotency key. Retrying the same valid plan returns the same owned project; it cannot overwrite an existing project. A changed name/source requires another review. Database failures roll back the complete nested create; transient failures may be retried using the same plan to recover a result when the response was lost. Expired plans require a new review. Browser navigation is disabled while requests are active, and unmounted requests are canceled. There are no automatic provider retries or GitHub mutations.

`Playground.githubSource` is optional JSON, independent of `TemplateFile.content`. Its versioned baseline retains provider, numeric repository identity, owner/name, selected branch, commit, root/selected tree, folder prefix, import timestamp, each imported relative/original path, blob SHA, Git mode, byte size and SHA-256 text hash, plus omitted entries and their source identities. Normal code saves and snapshot restores only update template content, preserving this baseline for Day 23 comparison. Ordinary project duplication creates an independent project without an import baseline.

## Rollout and verification

Regenerate the Prisma client (`npm run prisma:generate`). The existing optional MongoDB field requires no backfill; before deployment, apply the reviewed schema through the established database rollout. No new environment variables or OAuth scopes are needed. Never apply a production database change as part of a local verification run.

API tests use real routes/services, deterministic GitHub responses with real blob hashes, and the development database fixture. Panel tests cover omission consent and recovery. Chromium uses intercepted repository/import responses for real authenticated UI behavior; database persistence is verified separately by API tests. Live GitHub OAuth/public/private repositories, Atlas persistence, and organization/SSO restrictions require the configured external services and remain rollout checks.

Day 23 comparison/commits are documented separately in [review and commit](github-review-and-commit.md). Imports themselves never write to GitHub.

### Local verification record — October 7, 2026

- Full Vitest suite: **369 tests across 64 files passed**, including 26 import API/service tests and three import panel tests. Run directly with `node node_modules/vitest/vitest.mjs run --maxWorkers 2`; npm did not forward the worker limit in the first attempt, and five existing collaboration startup/convergence tests timed out. The two-worker rerun passed all cases.
- Prisma client generation, full project lint, application/collaboration TypeScript checks and production build passed. Build used process-only public fixtures and did not modify `.env.local`.
- All three GitHub Chromium scenarios passed, including import review, omission consent, success link and error-free browser navigation. The review screenshot was visually inspected. Repository/import responses were intercepted; persistence and failure rollback were verified separately through API tests.
- No live OAuth/repository check, MongoDB schema push, commit, push or deployment was performed. Earlier uncommitted work was preserved.

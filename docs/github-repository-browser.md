# GitHub repository browser — Day 21

**Projects → Connect GitHub → Browse repositories** opens a read-only repository browser. Users can paginate their accessible repositories and branches, select a branch, browse directories and preview supported text files. Repository import and GitHub writes remain Days 22 and 23.

## Connection and permissions

Use Day 20's [separate repository OAuth connection](github-connection.md). Each browsing request authenticates the LiveIDE user, loads and decrypts only that user's stored credential on the server, checks GitHub identity and the granted scopes, and rechecks the local connection before returning data. A revoked credential is removed through a conditional update. A disconnect or reauthorization during a provider request rejects the stale response.

Public-mode requests use `visibility=public` and filter out any private entries defensively. Direct branch/tree/file requests check repository metadata and reject private repositories unless private consent is retained. GitHub enforces repository membership, organization policies and SSO on every upstream request. A missing/private resource can produce 404, so the UI explains both absence and insufficient access. The browser lists repositories accessible to the connected account; it is not a global public repository search.

Provider tokens, credential records, arbitrary upstream URLs and raw error bodies never enter browser responses. The new `/api/github/browse` handler implements GET only and returns no-store JSON. Strict query validation rejects duplicate/unknown parameters and invalid repository identifiers. All upstream requests use fixed `https://api.github.com` endpoints, GET, no-store, rejected redirects, a ten-second timeout and propagated browser cancellation.

## Pagination and navigation

- Repository and branch pages contain at most 30 entries. GitHub's Link header supplies only a next-page boolean; its URL is never followed or forwarded.
- Selecting a branch resolves its root tree SHA. Directory pages contain at most 50 entries, with folders first. Fetches are non-recursive, so opening a repository does not load its entire source tree.
- Navigation references are signed with a domain-separated key derived from Day 20's encryption key. They bind the user, connection version, repository, branch label, immutable tree/blob SHA, path, kind and size, and expire after 30 minutes. They are navigation metadata, not provider credentials. Clients cannot submit arbitrary blob SHAs, size claims or paths.
- Directory/file requests verify the reference and recheck repository access. Navigation stays pinned to immutable tree objects even if the branch moves. **Refresh branch** resolves the latest branch root and clears prior navigation/preview state.
- Individual directory responses are limited to 5,000 entries and provider responses to 2 MiB, including streamed responses without Content-Length. Truncated/over-limit/unsafe trees fail clearly instead of silently showing a complete-looking partial list. No cross-user source cache is introduced; subsequent folder pages re-fetch that immutable directory.
- The browser cancels superseded/unmounted requests and ignores late responses. Repository/branch/folder navigation clears the previous source preview. There is no automatic retry loop.

## File restrictions

Text previews are limited to **256 KiB**, valid UTF-8, and an explicit set of source/config/document extensions and conventional filenames. This includes JavaScript/TypeScript, framework source, Markdown, JSON, CSS/HTML, shell scripts and common language source files. Previewing another language does not add a runtime for it.

Symlinks and submodules are displayed with an explanation and cannot be opened. Unsupported extensions and oversized/unknown-size files have no file navigation reference. Blob responses must match the signed SHA and byte size; invalid base64, invalid UTF-8, binary control bytes and Git LFS pointers are rejected. Empty files are supported. Files render as escaped `<pre>` text, including HTML, Markdown and SVG; no scripts, links, images, markup or repository code execute in a preview.

## Rate limits and failures

Provider 429 responses, exhausted primary limits, Retry-After and secondary rate-limit messages become a fixed rate-limit error with a retry timestamp and Retry-After header. The server retains a bounded process-local cooldown per user/connection version, without credentials or source data; subsequent requests during that cooldown make no provider calls. The UI disables retry/navigation until the cooldown expires. Serverless instances do not share this cooldown; GitHub remains the authoritative limit across instances.

Ordinary permission failures, missing resources, empty repositories, expired references, temporary outages, invalid responses and unsupported files each produce clear states. Permission errors do not erase valid credentials; unauthorized identity or changed scopes do. Users can retry, select the branch again, or manage/reconnect their GitHub connection as appropriate.

## Verification

API/security tests exercise real route/service code with mocked GitHub responses and the development database fixture. Panel tests exercise navigation, pagination, escaped rendering, cancellation, reconnect and cooldown states. Chromium verifies real authenticated navigation and browser behavior with intercepted deterministic repository data; it does not authenticate against live GitHub.

Real public/private repositories, organization/SSO behavior and live rate-limit responses require configured Day 20 OAuth credentials and the previously documented database rollout. No new database model or environment variable is introduced for Day 21. No import, source persistence, commit or deployment is performed by browsing.

### Local verification record — October 7, 2026

- Full Vitest suite passed **340 tests across 62 files**, including 22 repository API/security cases and five panel cases. The final run used `--maxWorkers=2` without a competing build. An earlier overlapping build/test run hit collaboration startup deadlines; the isolated run passed all of them.
- Full project lint, application and collaboration TypeScript checks, and the production build passed. Build configuration used process-only public fixtures; `.env.local` was not edited.
- All three GitHub Chromium scenarios passed: connection protection/unconfigured state; repository, branch and folder pagination with safely escaped previews; and permission/rate-limit UI. The main navigation scenario reported no page errors, and its screenshot was visually inspected.
- GitHub provider responses were mocked in API tests and intercepted in the browser fixture. No live OAuth/repository authorization or organization/SSO check was performed.
- No commit, push, deployment or database rollout was performed. Earlier uncommitted work was preserved; import and commit milestones remain unimplemented.

Provider references: [repository listing](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), [branches](https://docs.github.com/en/rest/branches/branches#list-branches), [non-recursive Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree), [Git blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob), [rate-limit handling](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#rate-limit-errors).

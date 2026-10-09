# LiveIDE daily development roadmap

## How to use this roadmap

Each development day has one coherent engineering outcome. A day is complete only when its acceptance checks pass. If work takes longer, continue the same stage rather than committing incomplete code to preserve an artificial schedule.

The suggested commits describe future work honestly. Do not backdate commits, create meaningless commits, or rewrite history to make the project appear older. Recruiters benefit more from a clear sequence of decisions, tests, and improvements than from commit volume.

For each day:

1. Start from a clean worktree and review the day's scope.
2. Implement and inspect the result locally.
3. Run the relevant automated and manual checks.
4. Review `git diff` and stage only related files.
5. Commit with the suggested message or a more accurate equivalent.
6. Push only after the local commit succeeds.

## Phase 1: trustworthy baseline

### Day 1 — Product foundation and architecture

Outcome:

- Document the objective, problem, scope, architecture, technical decisions, and non-goals.
- Record system flows, definition of done, interview answers, and the delivery roadmap.
- Link the documentation from the README.

Acceptance checks:

- Mermaid diagrams render on GitHub.
- Statements match implemented behavior.
- Documentation contains no secrets or machine-specific paths.

Suggested commit:

```text
docs: define LiveIDE architecture and delivery roadmap
```

### Day 2 — Reproducible quality pipeline

Outcome:

- Make installation, lint, typecheck, unit tests, build, and essential Playwright tests pass from a clean checkout.
- Add CI concurrency cancellation and useful failure artifacts.

Acceptance checks:

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Suggested commit:

```text
ci: make verification reproducible from a clean checkout
```

### Day 3 — Configuration and production safety

Outcome:

- Add typed environment validation.
- Fail closed when production secrets or database settings are unsafe.
- Prevent mock database and guest authentication in production.
- Require an independent collaboration secret.

Acceptance checks:

- Tests cover valid, missing, and unsafe configurations.
- Invalid production configuration fails with a useful message.

Suggested commit:

```text
feat(config): validate runtime environment and production invariants
```

### Day 4 — Browser and deployment security

Outcome:

- Consolidate COOP/COEP configuration.
- Restrict remote image hosts.
- Add suitable security headers and Content Security Policy.
- Detect unsupported WebContainer/cross-origin-isolation environments.
- Enable React Strict Mode and fix lifecycle problems it exposes.

Acceptance checks:

- OAuth, Monaco workers, WebContainers, and previews work in production mode.
- Unsupported browsers receive a clear explanation.

Suggested commit:

```text
security: harden browser isolation and deployment headers
```

### Day 5 — Observability and health

Outcome:

- Add request/error correlation IDs, application health, and collaboration readiness.
- Connect browser and server error monitoring.
- Record runtime and collaboration startup failures without leaking secrets.

Acceptance checks:

- A deliberate failure is correlated across response and logs.
- Health distinguishes healthy, degraded, and unavailable dependencies.

Suggested commit:

```text
feat(observability): add health checks and correlated errors
```

## Phase 2: collaboration correctness and performance

### Day 6 — Versioned realtime protocol

Outcome:

- Define typed client/server collaboration messages in a shared module.
- Add protocol version, project revision, room/file, role, and error contracts.

Acceptance checks:

- Runtime contract tests reject malformed and incompatible messages.
- Client and server compile against the same contracts.

Suggested commit:

```text
refactor(collaboration): introduce versioned protocol contracts
```

### Day 7 — Differential Yjs synchronization

Outcome:

- Formalize the state-vector handshake.
- Send only missing document updates on connection and recovery.
- Prevent remote updates from being echoed as new local changes.

Acceptance checks:

- Independently edited clients converge.
- Reconnection does not duplicate content.
- Measurements confirm incremental payloads.

Suggested commit:

```text
perf(collaboration): synchronize incremental Yjs updates
```

### Day 8 — Reconnection state machine

Outcome:

- Implement connecting, connected, reconnecting, offline, and failed states.
- Add bounded exponential backoff with jitter.
- Prevent duplicate sockets/listeners and resynchronize after recovery.

Acceptance checks:

- Tests cover disconnect, reconnect, server restart, and failed authentication.
- Presence and content do not duplicate.

Suggested commit:

```text
feat(collaboration): add resilient connection recovery
```

### Day 9 — Presence event control

Outcome:

- Separate cursors, selections, active files, and online state from durable updates.
- Throttle or coalesce high-frequency signals.
- Remove stale presence deterministically.

Acceptance checks:

- Cursor movement remains responsive without socket flooding.
- Presence is never stored as permanent history.

Suggested commit:

```text
perf(collaboration): isolate and throttle presence updates
```

### Day 10 — Collaboration authorization lifecycle

Outcome:

- Scope tokens to user, project, revision, room/file, role, and expiry.
- Enforce viewer read-only behavior at the collaboration service.
- Handle token expiry, membership changes, and revision invalidation.

Acceptance checks:

- Forged, expired, wrong-room, and revoked tokens fail.
- Old sessions cannot overwrite a restored project revision.

Suggested commit:

```text
security(collaboration): enforce scoped roles and revisions
```

### Day 11 — Collaboration performance suite

Outcome:

- Add deterministic 2-, 5-, and 10-client convergence scenarios.
- Measure server processing, network round trip, and client application time separately.
- Add a development diagnostics view.

Acceptance checks:

- No lost updates occur in controlled concurrent editing.
- Results and limitations are documented with measured numbers.

Suggested commit:

```text
test(collaboration): add convergence and latency scenarios
```

## Phase 3: editor and runtime smoothness

### Day 12 — Editor render boundaries

Implementation and repeatable profiling: [Editor render boundaries](editor-render-boundaries.md).

Outcome:

- Profile the playground.
- Keep Monaco instances/models stable across panel changes.
- Move high-frequency objects out of broad React state.
- Memoize only measured rerender hotspots.

Acceptance checks:

- Typing does not rerender the whole workspace.
- Opening terminal, preview, AI, or history does not remount Monaco.

Suggested commit:

```text
perf(editor): stabilize Monaco models and workspace renders
```

### Day 13 — WebContainer session lifecycle

Implementation and recovery checks: [Runtime lifecycle](runtime-lifecycle.md).

Outcome:

- Reuse an active WebContainer session where safe.
- Define boot, mount, install, start, ready, stopped, and failed states.
- Add cancellation and retry behavior.

Acceptance checks:

- Panel changes do not reboot the runtime.
- Failed install/process operations recover without a page refresh.

Suggested commit:

```text
refactor(runtime): formalize reusable WebContainer sessions
```

### Day 14 — Dependency/startup optimization

Outcome:

- Detect dependency-manifest changes and avoid unchanged reinstalls.
- Show separate mount, install, and server-start progress.
- Measure cold and warm startup times.

Acceptance checks:

- Warm startup is measurably faster.
- A manifest change triggers the required install exactly once.

Suggested commit:

```text
perf(runtime): reuse dependencies and measure startup phases
```

### Day 15 — Terminal and preview resilience

Implementation and verification: [Terminal and preview resilience](runtime-resilience.md).

Outcome:

- Bound retained terminal output and batch rendering where needed.
- Add preview readiness, reload, external-open, and failure states.
- Isolate runtime failures from editor state.

Acceptance checks:

- Large output does not freeze the workspace.
- Process exit and preview failure provide recovery controls.

Suggested commit:

```text
fix(runtime): harden terminal output and preview recovery
```

### Day 15 follow-up 1 — Run controls and live preview

- Label Run/Stop/Restart controls and run current drafts without saving.
- Add an opt-in, debounced source preview mode; keep Save as persistence.
- Preserve runtime reuse, dependency installation guards, editor models and drafts.
- Verify updates in a real preview with live mode on/off and after Stop/Run.

Implementation: [Runtime resilience and follow-up](runtime-resilience.md).

## Phase 4: collaboration product experience

### Day 16 — Follow collaborator mode

Status: implemented and locally verified. See the implementation guide for verification results and remaining deployment checks.

Outcome:

- Follow a participant's active file, cursor, selection, and scroll position.
- Stop following after intentional local navigation.

Acceptance checks:

- Follow mode never edits content.
- It stops when either participant leaves or loses access.

Suggested commit:

```text
feat(collaboration): add opt-in collaborator follow mode
```

Implementation: [Collaborator follow mode](collaborator-follow.md).

### Day 17 — Invitation lifecycle

Status: implemented and locally verified. Live database rollout and deployed transaction checks remain separate.

Implementation: [Invitation lifecycle](invitation-lifecycle.md).

Outcome:

- Add role-specific, expiring invitation links.
- Add revocation and clear expired/used states.
- Improve participant and member management.

Acceptance checks:

- Expired and revoked invitations cannot grant access.
- Only authorized roles can manage invitations.

Suggested commit:

```text
feat(sharing): add expiring and revocable invitations
```

### Day 18 — Collaborative project notes

Status: implemented and locally verified. Live MongoDB/Redis and deployment checks remain separate.

Implementation: [Collaborative project notes](collaborative-notes.md).

Outcome:

- Add a separate Yjs-backed notes document.
- Keep notes independent from source-file state.
- Render Markdown safely if supported.

Acceptance checks:

- Notes converge independently of the active code file.
- Rendered content cannot execute unsafe markup.

Suggested commit:

```text
feat(collaboration): add shared project notes
```

### Day 19 — Shared runtime status

Status: implemented and locally verified. Live engine, MongoDB/Redis, and deployment checks remain separate.

Implementation: [Shared runtime status and controls](shared-runtime.md).

Outcome:

- Share sanitized process state, preview readiness, and bounded terminal output.
- Define who can start, stop, or restart the runtime.
- Do not expose an unrestricted shared shell.

Acceptance checks:

- Secrets/environment values are not broadcast.
- Viewers cannot perform restricted runtime operations.

Suggested commit:

```text
feat(runtime): share sanitized process and preview status
```

## Phase 5: GitHub workflow

### Day 20 — GitHub connection security

Status: implemented and locally verified. Real GitHub authorization/revocation and live database rollout remain separate checks before production enablement.

Implementation: [GitHub connection security](github-connection.md). Local verification and live-provider/database limitations are recorded there.

Outcome:

- Add least-privilege GitHub OAuth connection, secure credential storage, and revocation.
- Keep provider tokens out of browser-visible payloads.

Acceptance checks:

- Public/private repository permissions behave correctly.
- Disconnecting invalidates stored access.

Suggested commit:

```text
feat(github): add secure repository connection flow
```

### Day 21 — Repository browser

Status: implemented and locally verified. Live GitHub public/private access, organization/SSO policies and deployed rate-limit behavior remain separate checks using the Day 20 setup.

Implementation: [GitHub repository browser](github-repository-browser.md).

Outcome:

- Browse repositories, branches, and supported source trees.
- Handle pagination, rate limits, empty states, and permissions.

Acceptance checks:

- Large repository lists remain responsive.
- Binary and oversized files are rejected clearly.

Suggested commit:

```text
feat(github): browse repositories branches and source trees
```

### Day 22 — Repository import

Local implementation completed October 7, 2026. See [repository import](github-repository-import.md) for the workflow, validation, source baseline, verification and external rollout checks.

Outcome:

- Import a repository/folder into a new project.
- Validate project size and file paths.
- Preserve source metadata for later comparison.

Acceptance checks:

- Import never silently overwrites a project.
- Path traversal and oversized content fail safely.

Suggested commit:

```text
feat(github): import repositories into LiveIDE projects
```

### Day 23 — Review and commit changes

Local implementation completed October 7, 2026. See [GitHub review and commit](github-review-and-commit.md) for explicit write consent, saved-file comparison, confirmed new-branch publication, durable recovery and external rollout checks.

Outcome:

- Compare project files with the source branch.
- Show additions, modifications, and deletions before committing.
- Commit to a new branch by default.

Acceptance checks:

- No GitHub mutation occurs without explicit confirmation.
- Partial failure produces a recoverable result.

Suggested commit:

```text
feat(github): review and commit project changes safely
```

## Phase 6: storage and history maturity

### Day 24 — Resource limits

Status: implemented and locally verified. Production MongoDB transaction contention remains a separate rollout check.

Implementation: [Resource limits and remediation](resource-limits.md). Local checks and production verification limitations are recorded there.

Outcome:

- Define and enforce file count, file size, project size, snapshot, chat, and terminal limits.

Acceptance checks:

- Boundary and over-limit tests pass.
- Error messages explain remediation.

Suggested commit:

```text
feat(storage): enforce project and history resource limits
```

### Day 25 — Storage model evaluation

Status: implemented as a reproducible offline evaluation. Retain whole-tree JSON for the bounded beta; no migration is justified yet. Live MongoDB payload/storage and workload measurements remain separate deployment checks.

Implementation and results: [Storage evaluation](storage-evaluation.md). Run `npm run verify:storage` to regenerate the content-free report.

Outcome:

- Measure JSON document size and write amplification.
- Decide whether per-file records or object storage are justified.
- Implement only a migration supported by evidence.

Acceptance checks:

- Existing projects remain readable.
- Any migration is repeatable and recoverable.

Suggested commit, only if a migration is implemented:

```text
refactor(storage): separate scalable project file persistence
```

### Day 26 — Immutable snapshot semantics

Status: implemented and locally verified. Immutable captures, owner-controlled retention, transactional restore/deletion audits, and stale restore protection are covered by the 450-test suite and a browser history scenario. Live MongoDB transaction contention remains a rollout check.

Implementation: [Immutable project history](immutable-history.md). Current saved state, evolving collaboration checkpoints, immutable snapshots, owner-controlled retention, and transactional restore/deletion audits are defined there.

Outcome:

- Formalize current state, collaboration checkpoints, and named immutable snapshots.
- Add retention behavior and complete restoration audit details.

Acceptance checks:

- Restore creates new history.
- Snapshots cannot be mutated through normal operations.

Suggested commit:

```text
feat(history): enforce immutable snapshots and restore history
```

### Day 27 — Backup/recovery verification

Status: implemented and verified with a real isolated MongoDB replica set. All 22 fixture documents across 13 collections and their indexes recovered, survived a restart, and passed five application checks. Backup scheduling/off-host storage and deployed recovery timing remain operational rollout checks.

Implementation, measurements and procedures: [Database backup and recovery](database-recovery.md). Run `npm run verify:recovery` with MongoDB Server and Database Tools available.

Outcome:

- Document and test MongoDB project/checkpoint recovery.
- Record recovery time and expected data-loss window.

Acceptance checks:

- A controlled restore drill succeeds.
- The runbook contains verification steps.

Suggested commit:

```text
docs(operations): add verified backup and recovery runbook
```

## Phase 7: production beta

### Day 28 — Vercel deployment

Outcome:

- Configure preview and production environments.
- Verify OAuth, database connectivity, headers, WebContainers, and monitoring.

Acceptance checks:

- Preview smoke tests pass.
- No development secret or mock mode is enabled.

Suggested commit:

```text
chore(deploy): prepare Vercel preview and production environments
```

### Day 29 — Collaboration deployment

Outcome:

- Deploy the long-running collaboration service.
- Configure `wss://`, trusted origins, secrets, health checks, graceful shutdown, and managed Redis when scaling beyond one instance.

Acceptance checks:

- Clients recover through a controlled restart.
- Cross-instance convergence passes in distributed mode.

Suggested commit:

```text
chore(deploy): productionize the collaboration service
```

### Day 30 — Production-beta release gate

Outcome:

- Run CI, security, performance, browser, recovery, and accessibility checks.
- Publish known limitations and operational runbooks.
- Update README/resume claims with measured results.

Acceptance checks:

- Create, edit, run, invite, collaborate, save, and restore pass end to end.
- No critical/high-severity known defect remains.
- Rollback is tested.

Suggested commit:

```text
release: prepare LiveIDE production beta
```

## Later roadmap

- Remote isolated execution for selected non-JavaScript languages
- Workspace/team organizations backed by demonstrated demand
- Deployment integrations and project release comparison
- Advanced AI actions with explicit review and rollback
- Voice/video only if user research proves it belongs inside the product

## Daily Git workflow

After reviewing Day 1, use:

```bash
git status
git diff
git add README.md docs/project-foundation.md docs/architecture.md docs/development-roadmap.md
git diff --staged
git commit -m "docs: define LiveIDE architecture and delivery roadmap"
git push origin main
```

If a command fails, stop and inspect the error. Do not use `--force`, skip checks, or reset changes just to make a push succeed. Share the exact command and full error output for diagnosis.

For implementation work, prefer a feature branch and pull request:

```bash
git switch -c feature/collaboration-recovery
git push -u origin feature/collaboration-recovery
```

The pull request should explain the problem, approach, verification, and remaining limitations. This creates credible history through engineering evidence—not through artificially increasing commit count.

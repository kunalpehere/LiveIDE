# Immutable project history — Day 26

## State boundaries

| State | Purpose | Mutation rule |
| --- | --- | --- |
| Current saved tree (`TemplateFile`) | Durable explicit saves and restored source files | Saves/restores replace content and advance its version |
| Collaboration checkpoint (`CollaborationDocument`) | Recover evolving Yjs state for a source file or notes room | Can be replaced; source checkpoints are invalidated on restore |
| Named snapshot (`PlaygroundSnapshot`, `MANUAL`) | Fixed copy of the saved tree at a captured version | Content, captured version, name, author and creation time are never updated by normal application operations |
| Safety snapshot (`RESTORE_POINT`) | Fixed pre-restore copy for undoing a restore | Same immutability rule as a named snapshot |
| History event (`PlaygroundHistoryEvent`) | Record who created, restored or deleted a snapshot | Application operations append events rather than modifying existing events |

A named snapshot captures **saved source**, not another collaborator's unsaved edits, a live runtime, terminal output, or the newest independent Yjs checkpoint. The history UI requires local changes to be saved before creating/restoring. Project notes remain separate and are preserved during source restoration.

The first snapshot of a project with no saved tree captures its starter at version **0**. The first persisted restore creates version **1**. Existing native trees and legacy JSON strings containing trees are captured/restored without converting the original snapshot's representation.

Immutability here is an application contract, not database write-once enforcement: no snapshot update action exists. Privileged database operators can still change records. Development mock delegates clone snapshot content on insert/read and respect metadata-only selections so returned values cannot accidentally mutate the stored fixture or expose content through the history list.

## Restore transaction

Restoration reads and validates its target **inside** the transaction, scoped to the authorized project. It then:

1. Reads the current saved tree and version. The history UI supplies its displayed current version; stale requests are rejected with `SAVE_CONFLICT` before any writes.
2. Validates the safety copy, contends on the project row, and checks snapshot capacity. No existing snapshot is modified or removed to create capacity.
3. Advances the collaboration revision and inserts a new immutable `RESTORE_POINT` containing the pre-restore saved tree and version.
4. Replaces the current saved tree with a copy of the target and advances the **current** version. It never resets the current version to the target's older captured version.
5. Deletes source-file collaboration checkpoints, preserving `.liveide/notes`.
6. Appends a `SNAPSHOT_RESTORED` event with actor ID/name, timestamp, target ID/name/captured version, previous/resulting saved versions, safety snapshot ID/name, and the resulting collaboration revision.

All six steps commit or roll back together. A failed audit write therefore cannot leave a partially restored project or an unaudited successful deletion. Clients reload after success to enter the new collaboration revision. Repeated restores create distinct safety copies and new events even when the source content is the same.

The optional expected-version argument preserves compatibility with existing callers; the current UI always supplies it. A caller omitting it intentionally restores against the transaction's current saved state and still receives a safety copy. MongoDB/Prisma write contention (`P2034`) becomes a recoverable `HISTORY_CONFLICT`; refresh history and explicitly retry. Failed transactions are not automatically retried as new restore requests.

Concurrent snapshot creation, restore and deletion contend on the same project row. The target read and deletion are therefore transactionally coordinated. Restore and ordinary saves contend on the saved-tree record. Real database behavior requires MongoDB transactions on a replica set; the serialized development fixture demonstrates application invariants but does not prove database contention behavior.

## Retention and audit

- Each project retains at most **50 snapshots total**, combining named snapshots and safety copies.
- Both kinds remain until the **owner explicitly deletes** them. There is no expiration or silent automatic pruning.
- At capacity, creation and restore are blocked. Restore requires one free slot for its safety copy. The UI displays the count/limit and disables those operations when full; the server remains authoritative under concurrency.
- Editors may create and restore snapshots; viewers may read history; only the owner may delete snapshots. Snapshot IDs are always scoped to the current project.
- Deletion reads the target, locks the project, removes exactly one snapshot and appends its audit event in one transaction. A failed/missing concurrent target cannot create a false successful deletion event.
- Audit references are scalar IDs/names/version values rather than cascading relations. Deleting a target or safety snapshot does not erase earlier creation/restore/deletion audit details. Its source content is no longer recoverable through the deleted copy; the audit record is not a content backup.
- Snapshot and activity lists show the latest 50 entries, ordered by creation time then ID. **Displaying only the latest 50 events is not event retention:** audit events are not pruned in Day 26. History reads do not include snapshot content.

If legacy data already exceeds the cap, reads still work and the real count is displayed. New snapshots/restores remain blocked until owner deletion frees capacity. Historical events lacking the new optional audit fields render without fabricated details.

## Schema and rollout

The history-event schema adds nullable fields: `snapshotVersion`, `previousVersion`, `resultingVersion`, `restorePointId`, `restorePointName`, and `collaborationRevision`. Existing snapshots and events require no content migration or audit backfill; older events cannot be assigned version details that were never recorded.

Regenerate the Prisma client with `npm run prisma:generate`. Include the updated schema/client in the normal deployment procedure and controlled `npm run db:push` validation for the intended MongoDB replica set. This local implementation does **not** push a schema to a live database or deploy the application. See Day 27 for actual backup/recovery verification.

## Verification

Application-operation tests exercise snapshot immutability after later saves, repeated restores and mutated returned values; native/legacy formats; increasing current versions; safety-copy contents; complete restore audit details; audit survival after deletion; rollback of failed restore/delete audits; last-slot contention; stale concurrent restore rejection; project-scoped targets; and notes preservation.

Focused unit tests also cover permissions, over-cap behavior, invalid expected versions, missing deletion targets and mapped transaction conflicts. The browser scenario creates a snapshot, restores it, verifies its captured version is unchanged, checks the safety copy/version audit, deletes the target and verifies that the earlier audit remains visible. The dialog blocks duplicate in-flight mutations and offers an explicit refresh action.

## Local verification — October 8, 2026

- Full automated suite: **450 tests passed across 71 files**, run with one worker to avoid competing local wire-test startup deadlines.
- Focused history verification: **17 tests passed**, included in the full suite.
- New Chromium history scenario: **passed**, exercising real server actions against the development mock database.
- Prisma client generation, application/collaboration type checking, repository lint, and the production build passed.
- The build used process-only production-safe fixture settings; `.env.local` was not edited. The isolated browser server was stopped after verification.
- No live schema push, database migration, hosted CI run, Git commit/push, or deployment was performed. Live MongoDB transaction rollback/contention on a replica set remains a separate rollout check.

Day 27 follow-up: [database recovery verification](database-recovery.md) now exercises real MongoDB rollback of a deliberately rejected restore audit and a successful restored snapshot transaction. Production contention and deployment checks remain separate.

# Project storage evaluation — Day 25

## Decision

Retain the existing versioned whole-tree `TemplateFile.content` JSON model for the bounded beta. No schema change, database migration, external storage dependency, or application save/load behavior change is introduced by Day 25.

All six actual starter projects are small (937–4,721 bytes of compact tree JSON). Larger synthetic projects show that per-file persistence could substantially reduce content payloads for small edits. We do not yet have a production distribution of project sizes, explicit save frequency, save latency, or database costs that justifies taking on a migration before release. This decision is conditional on the Day 24 limits and the current explicit-save workflow; it is not a claim that whole-tree persistence scales indefinitely.

This concerns **users' project data**, not the checkout's `node_modules`, `.next`, or GitHub source archive size.

## Existing persistence boundaries

- `TemplateFile` contains one tree per project, enforced by its unique `playgroundId`, and a version counter. `SaveUpdatedCode` submits the complete tree and advances that version; with an expected version it uses a conditional update to reject stale saves. It can write unchanged content too.
- `PlaygroundSnapshot.content` copies the saved tree. Snapshots are explicitly created, including safety copies on restore, rather than created on every keystroke/save. The cap is 50, including restore points.
- `CollaborationDocument` already persists state per file/room. Yjs edits and checkpoint traffic are separate from the whole-tree save action. These measurements do not represent CRDT traffic.
- Native JSON trees and older JSON strings containing trees remain supported by the application reader. An explicit save may produce a native tree from a loaded legacy string. Existing oversized legacy projects remain readable, while new saves must meet current limits.

The source-content cap is 2 MiB, the compact normalized tree cap is 3 MiB, and the file cap is 250. A native tree at the 3 MiB cap plus 50 full-sized native snapshots would contain at most **153 MiB of JSON content payloads**. This excludes record metadata, indexes, chat, checkpoints, commit operations, history events, and storage-engine overhead. It is not a total disk quota. Legacy string representations can use more bytes through an extra layer of JSON escaping and are reported separately.

## Reproduction

```bash
npm run verify:storage
```

This runs the offline Vitest measurement harness and writes `reports/storage-evaluation.json`. It scans all six starter directories through the application's `scanTemplateDirectory`, with the same ignored files/folders, then evaluates six deterministic fixtures: empty, 100 files, near the source-byte cap, 250 files, near the JSON-byte cap, and Unicode/escaping with an empty folder.

The report contains counts, byte totals, and modeled comparisons only. It contains no file content, project IDs, credentials, or database connection details. It is ignored by Git and uploaded as a CI artifact. The compact results below remain in source control. The harness opens no database connection and makes no network requests. Tests assert identical results across two evaluations; timestamps/timings are intentionally absent from the report.

## Measurement method

`lib/storage-evaluation.ts` validates the trees against current resource limits and schemas, preserves empty folders, and rejects ambiguous duplicate paths rather than silently collapsing them into a per-file map.

- **Source bytes:** the sum of UTF-8 text content sizes, excluding names and tree metadata.
- **Tree JSON bytes:** `Buffer`/UTF-8 equivalent byte length of compact `JSON.stringify` for the normalized native tree. Escapes, paths, folder names, and structure contribute to this value.
- **Persisted content JSON bytes:** the compact JSON encoding of the supplied content field. For a legacy string this includes the outer string quotes/escaping. This is a JSON serialization metric, **not BSON document size**.
- **Current content write bytes:** compact JSON size of the next content field submitted in a modeled save. It excludes the version counter, timestamps, Prisma/MongoDB envelopes, and all subsequent reads.
- **Content edit bytes:** bytes removed plus inserted in the smallest contiguous UTF-8 byte replacement, summed across changed paths. A one-byte append has denominator 1. Renames are treated as delete/add paths, not inferred moves. Unchanged saves have no amplification ratio (`null`), although the current action still writes content.
- **Payload amplification:** current content write bytes divided by content edit bytes. This describes application content payloads; it does not estimate storage-engine write amplification, journal/oplog size, network traffic, compression, latency, or billing.

Every nonempty scenario includes unchanged-save, one-byte append, append-to-up-to-ten-files, and a same-source-byte-length rewrite of one file. The larger fixtures intentionally expose the sensitivity to small edits; they are synthetic workloads, not representative user telemetry. Baseline storage sizes are not throughput benchmarks.

The alternatives are **illustrative models**, not implemented persistence paths:

1. **Per-file records:** `{ playgroundId, path, content, version }` per file, plus a project manifest containing the root name, empty-folder paths, and version. A save writes complete changed-file records and the manifest. Deletions are counted separately as operations. A real implementation still needs a transaction/version fence across changed files and folder metadata, consistent reads, snapshot/restore behavior, authorization, and migration tooling.
2. **Content-addressed objects:** UTF-8 raw content keyed by SHA-256, plus a whole-project JSON manifest listing paths/hashes/byte counts and folders. Identical content shares an object; a save uploads changed content not already in the previous state and rewrites the manifest. Object existence checks, requests, database commit coordination, historical objects, and garbage collection are excluded. Hashing does not eliminate manifest writes. No compression savings are assumed.

For comparison, the model fixes a representative project ID and version of 1; differing real ID lengths and growing version digits affect record overhead. The manifests model paths/folders but do not encode the current tree's sibling display order; preserving that order would require additional metadata during an actual migration. Raw UTF-8 objects also require a reversible encoding policy for JavaScript strings containing unpaired surrogates before they could replace JSON. Logical alternative payloads must not be presented as achieved optimization results.

## Local results — October 8, 2026

All sizes below are bytes. The three save columns measure a one-byte append to the first selected file, including model manifests where applicable.

| Scenario | Files | Source | Tree JSON | Current save | Per-file model save | Object model save |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| React starter | 8 | 1,918 | 2,597 | 2,598 | 486 | 1,289 |
| Next.js starter | 5 | 1,918 | 2,517 | 2,518 | 523 | 986 |
| Express starter | 2 | 711 | 937 | 938 | 603 | 728 |
| Vue starter | 6 | 1,106 | 1,634 | 1,635 | 464 | 1,044 |
| Hono starter | 2 | 777 | 1,013 | 1,014 | 650 | 775 |
| Angular starter | 7 | 3,784 | 4,721 | 4,722 | 1,523 | 2,109 |
| 100-file fixture | 100 | 409,600 | 415,423 | 415,424 | 4,285 | 15,295 |
| Near source cap | 8 | 2,097,144 | 2,097,637 | 2,097,638 | 262,336 | 263,152 |
| 250-file fixture | 250 | 128,000 | 142,677 | 142,678 | 705 | 28,265 |
| Near JSON cap | 12 | 1,572,000 | 3,144,756 | 3,144,757 | 262,193 | 132,504 |
| Unicode/escaping | 1 | 57,344 | 82,052 | 82,053 | 82,125 | 57,581 |

The 100-file fixture's one-byte append writes approximately **97 times** as much content payload in the current model as the per-file model. The Unicode single-file fixture shows the opposite overhead tradeoff: the per-file record plus manifest is slightly larger than the existing tree. The near-source-cap fixture still rewrites an approximately 256 KiB changed file under both alternatives; neither model stores tiny text patches. Object manifests grow with file count, as the 250-file case demonstrates.

These are measured offline payload comparisons, not latency reductions or production storage savings. A 415,424-byte content write for a one-byte edit must not be described as 415,424 times as much physical MongoDB disk I/O.

## Revisit criteria and migration gate

Before expanding limits or enabling frequent automatic whole-tree saves, collect a read-only, authorized inventory of real project content sizes and formats, snapshot counts/content sizes, save rate, and p50/p95 save/read latency. Use content-free aggregates. Measure database BSON sizes and storage/replication behavior separately on a controlled MongoDB deployment; do not infer them from this report.

Prioritize a per-file prototype if real larger projects and repeated small saves produce material save latency or payload/cost pressure. Evaluate object storage if measured historical content retention or binary/large-file requirements exceed the bounded text-only model. Define deployment latency and cost budgets before making that decision. A need for larger limits invalidates the current bounded-beta rationale even if latency is acceptable.

A future migration must not run the existing one-way legacy-string conversion as a substitute for a storage redesign. Its gate is:

1. Preserve the original tree/version and record a format version; provide dry-run counts and invalid-record handling.
2. Backfill idempotently with project/version keys, verify content hashes, file paths, empty folders, and reconstructed trees, and avoid replacing concurrently edited versions.
3. Retain compatible readers and conditional writes throughout staged cutover; preserve invitations/access controls, named snapshots, restore safety copies, GitHub workflows, notes, and collaboration revision fencing.
4. Demonstrate rollback from an intact copy, interrupted-run recovery, repeated migration runs, and concurrent-edit handling in controlled database tests before production cutover.

Day 25 introduces no migration, so repeatability/recovery of a new migration is not applicable. Keeping the original persistence format provides compatibility directly. Day 26 will formalize snapshot semantics; Day 27 will exercise database backup/recovery.

## Verification

Local checks passed: **44 tests across five files**, including the seven storage evaluation tests, existing reader compatibility, authorization, resource limits, save conflicts, and history regressions. Repository lint and application/collaboration type checking passed. The storage harness covers Unicode/escaping, native and legacy representations, one-byte edits, unchanged saves, deleted/renamed paths, shared content objects, empty folders, ambiguous input, policy boundaries, and repeatable content-free reports.

The dedicated storage command uses the default reporter so its CI run cannot overwrite the full suite's JUnit report. No application UI or production persistence code was changed, so browser/build benchmarks are not claimed for this milestone. Live MongoDB measurements and hosted CI remain separate from these local results.

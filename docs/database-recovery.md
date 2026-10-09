# Database backup and recovery — Day 27

## Verified scope

The controlled drill backs up real MongoDB BSON data and indexes, deletes its disposable source database, restores into a separate empty database, compares recovery against the pre-backup baseline, restarts MongoDB, and checks the recovered database through application code.

It runs its own single-node replica set, bound to `127.0.0.1` on an automatically selected port, with nonce-named source/restored databases and a newly created temporary data directory. **It never uses the application's `DATABASE_URL` or changes `.env.local`; database clients receive only generated drill URIs.** Only tool locations can be supplied. It does not connect to an existing MongoDB service, download data from a provider, publish GitHub operations, or change production settings.

The fixture contains **22 documents across all 13 Prisma models**:

| Collection | Documents | Recovery coverage |
| --- | ---: | --- |
| User | 3 | Owner, editor and viewer identities |
| Account | 1 | Identity-provider link, synthetic token |
| GitHubConnection | 1 | Stored connection/envelope fields, synthetic values |
| Playground | 2 | Ownership, collaboration revision, import metadata, pending commit lock |
| TemplateFile | 2 | Native JSON and legacy serialized tree, versions, Unicode and empty folder |
| PlaygroundSnapshot | 2 | Named immutable capture and safety copy |
| PlaygroundHistoryEvent | 3 | Creation, detailed restoration, and audit reference to a deleted snapshot |
| CollaborationDocument | 2 | Source-file Yjs state and independent project notes |
| PlaygroundMember | 2 | Editor/viewer memberships |
| PlaygroundInvitation | 1 | Hashed invitation token and expiry |
| StarMark | 1 | User/project association |
| ChatMessage | 1 | Persisted chat |
| GitHubCommitOperation | 1 | Pending operation state; not remotely resumed |

The verifier checks collection coverage, counts, canonical hashes of MongoDB Extended JSON and Prisma reads, and index definitions. Index field order is preserved in the comparison, including unique/partial/sparse/TTL/collation options where present. Hashes normalize object-key order, preserve array order and dates, and distinguish missing fields from null; they are not byte-for-byte hashes of the entire database files.

The five real database application checks verify:

1. Current native/legacy project reads retain saved versions and owner access.
2. Editor/viewer roles survive; viewer mutation and unrelated-user reads remain forbidden.
3. The actual collaboration hydration route returns the restored source/notes checkpoints, which decode to the expected Yjs text.
4. A server-side MongoDB validator deliberately rejects a restore audit insert. The real transaction rolls back the tree, version, project revision, safety snapshot and source checkpoint deletion.
5. A successful snapshot restoration advances the current version, preserves the original immutable snapshot, creates the correct safety copy, retains earlier audit, records complete restore details and preserves notes.

Authentication and Next cache calls are replaced with deterministic fixture identity/cache behavior for those tests; MongoDB, Prisma, history actions, authorization logic, snapshot hydration and Yjs are real. This is not an OAuth login, WebSocket/browser reconnection, provider-token decryption or deployed traffic benchmark.

## Run the isolated drill

Prerequisites: Node.js 22, `npm ci`, `npm run prisma:generate`, MongoDB Community Server, and the official MongoDB Database Tools containing `mongodump` and `mongorestore`. Use compatible server/feature-compatibility versions for source and target. See [MongoDB tools installation](https://www.mongodb.com/docs/database-tools/installation/) and [restore compatibility](https://www.mongodb.com/docs/database-tools/mongorestore/).

On Windows, the default server path is `C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe`. Set `RECOVERY_MONGOD` if installed elsewhere. On other platforms the default is `mongod` on PATH. Database tools are resolved from PATH or `RECOVERY_TOOLS_DIR`.

```powershell
$env:RECOVERY_MONGOD = 'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe'
$env:RECOVERY_TOOLS_DIR = 'C:/Tools/mongodb-database-tools/bin'
npm run verify:recovery
```

```bash
RECOVERY_MONGOD=/opt/mongodb/bin/mongod \
RECOVERY_TOOLS_DIR=/opt/mongodb-tools/bin \
npm run verify:recovery
```

The command checks tool versions before starting, initializes the disposable replica set, pushes the Prisma schema **only to its generated source**, seeds fixtures transactionally, and captures a quiesced single-database gzip archive. It creates two later changes, drops only that generated fixture database, and restores via namespace mapping into the empty generated target. Archive integrity is checked before restore; restore stops on errors. No `--drop` option or operator-supplied database URI is accepted.

Application tests refuse credentials, non-loopback hosts, foreign database names, mismatched replica-set/run IDs, duplicate query parameters, source databases as targets, and unexpected connection options. Normal `npm test` visibly skips the five database tests when no drill URI is present. **`npm run verify:recovery` requires all five to pass** using a structured JSON test report; a skip cannot satisfy the command. Its isolated report does not overwrite the unit suite's JUnit results.

The final content-free report is `reports/recovery-drill.json`. It includes outcome, tool versions, counts, digests, archive bytes/hash, backup timestamps, measured phases, and cleanup checks. On command failure, `reports/recovery-drill-error.log` contains diagnostics from synthetic fixtures only. A new run replaces the old report with `running`, then `passed` or `failed`; inspect status and phase, not merely file existence.

The owned MongoDB child is stopped and its exact temporary directory, fixture archive and test output are removed, including on failure. The portable tools used for the recorded drill were downloaded into the OS temporary directory from MongoDB's official release feed and checksum-verified; they are outside the repository. The scripts contain no download/install step and require tools to be available when rerun.

## Recorded local result — October 8, 2026

Final verification used Windows, Node **22.14.0**, MongoDB **8.2.5**, Database Tools **100.19.1**, and Prisma **6.10.0**.

| Measurement/check | Result |
| --- | --- |
| Collections/documents recovered | **13 / 22**, all matched |
| Index definitions | Matched, including compound key order |
| Gzip fixture archive | **3,075 bytes** |
| Backup command | **285 ms** |
| Restore command | **1,627 ms** |
| Recovery + comparison + server restart + application verification | **9,842 ms** |
| Entire drill including provisioning/schema/seed/backup | **16,499 ms**, cleanup excluded |
| Backup age at simulated incident | **338 ms** |
| Intentional changes made after the backup | **2**, both correctly absent from restored baseline |
| Application checks on restored MongoDB | **5 passed** |
| Isolated server stopped / temporary data removed | Both confirmed |

Two earlier complete drills also passed. The final report records the hardened verifier's measurements above. Random IDs, timestamps and Yjs client IDs cause archive sizes/digests to vary between runs; comparison is against each run's own captured baseline.

These timings describe a **tiny local fixture**. Recovery timing begins at the restore stage after simulated loss and includes validation/restart/application tests, but excludes incident detection, operator response, tool installation, external archive transfer, decryption, new infrastructure provisioning and production cutover. They establish a successful controlled recovery, not a production RTO or performance guarantee.

## Backup policy and expected data-loss window

**Recovery time (RTO measurement)** is the elapsed recovery/verification stage. A deployed operational RTO remains to be defined and measured against realistic data volumes and the complete incident procedure.

**Recovery point/data-loss window (RPO)** is determined by the most recent complete, verified, consistent backup point. If the incident occurs at time `T` and that point is `B`, persisted changes in `(B, T]` can be lost. The drill's 338 ms interval deliberately contains two writes that the restored backup excludes. It does not establish a 338 ms production RPO.

Proposed beta policy: one complete verified backup every 24 hours, seven daily copies and four weekly copies in encrypted storage outside the database host, with a restore drill before release and periodically thereafter. **This policy is documented, not scheduled or enabled by this change.** With successful on-time backups, expected exposure is up to the backup interval plus capture/transfer/verification lag. Failed or missed backups extend that exposure; monitor the age of the last verified backup and alert on failure/staleness.

Persisted Yjs checkpoints can be newer than the explicitly saved tree and are recovered separately. Browser-local edits or changes not acknowledged by checkpoint persistence before the backup point are outside database recovery. Project snapshots and checkpoints share the database failure domain and do not replace an external database backup.

## Operational backup procedure

This is an operator procedure for the intended deployment; the isolated drill does not execute it against user data.

1. Record deployment/schema version, MongoDB version/FCV, collection inventory, last persisted checkpoint times, and the backup point. Provision the intended backup/restore permissions. Application user/access records are backed up; MongoDB administrative users/roles and infrastructure credentials need their own provisioning/recovery procedure.
2. For this verified **single-database** method, pause all application database writers, collaboration checkpoint writers and background workers, and allow outstanding transactions to finish. Obtain successful saves/checkpoint acknowledgements before the pause where possible. Keep writers paused throughout baseline inventory and dump; record the acknowledged persisted state rather than assuming every live edit was flushed.
3. Use a secured MongoDB tools YAML config file for the connection URI/credentials. Keep credentials out of shell history and process arguments. MongoDB documents the [tools config option](https://www.mongodb.com/docs/database-tools/mongodump/#std-option-mongodump.--config).
4. Dump the complete application database with metadata/indexes. An illustrative PowerShell command, with operator-provided paths, is:

   ```powershell
   mongodump --config 'C:/SecureOperations/source.yml' --db liveide --archive 'C:/SecureBackups/liveide.archive.gz' --gzip
   if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
   Get-FileHash -LiteralPath 'C:/SecureBackups/liveide.archive.gz' -Algorithm SHA256
   ```

5. Resume writers only after successful capture, preserving the original consistency point. Encrypt and copy the archive plus manifest to the separate backup destination. The manifest should include schema/server/tool versions, capture point, counts/index definitions, hashes, and verification state. Verify the copied ciphertext/archive integrity and availability; retain encryption keys through the independent secret-management procedure. Never commit real archives or credential configs to Git or upload them as ordinary CI artifacts.
6. Record backup failure/staleness and retry through the operator procedure. Never prune the last verified recoverable copy because a newer capture merely started.

For online backups while accepting writes, choose and verify a separate strategy: managed provider snapshots/point-in-time recovery, or a full replica-set member dump with `--oplog` and corresponding `--oplogReplay` recovery. **`mongodump --oplog` cannot be combined with `--db`**. The current namespace-mapped single-database drill does not test online oplog replay or point-in-time recovery. See [MongoDB consistency requirements](https://www.mongodb.com/docs/database-tools/mongodump/#std-option-mongodump.--oplog).

## Operational restore procedure

1. Stop writes to the affected application and preserve the damaged database/evidence. Select a verified backup and record its data-loss interval. Do not overwrite the sole surviving database or restore directly into production first.
2. Provision a separate, empty MongoDB replica-set target with compatible version/FCV. Restore the necessary infrastructure/secrets independently, including the GitHub token encryption key if stored connections are to remain decryptable. Keep outbound GitHub/AI operations and background jobs disabled during verification.
3. Verify archive integrity/decryption. Configure the tools connection for the **target deployment**, without conflicting source database names. Map the application namespaces to a new target database:

   ```powershell
   mongorestore --config 'C:/SecureOperations/target.yml' --archive 'C:/SecureBackups/liveide.archive.gz' --gzip --nsInclude 'liveide.*' --nsFrom 'liveide.*' --nsTo 'liveide_restore_20261008.*' --stopOnError
   if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
   ```

   MongoDB documents [namespace mapping](https://www.mongodb.com/docs/database-tools/mongorestore/#std-option-mongorestore.--nsFrom). Do not add `--drop` as a routine repair step. A failed attempt should be investigated and retried into another empty target rather than merged with a partial restore.

4. Verify all collections, document counts, field/content hashes and index definitions against the capture manifest. Check ownership/memberships/invitations, native/legacy project reads, saved versions, immutable snapshots, safety copies and audit references. Decode Yjs state, validate notes/source room revisions, and compare persisted text to the expected backup state. Exercise rollback and snapshot restoration on a disposable copy. The committed application verifier uses known synthetic fixture IDs and is not a generic validator for an arbitrary production archive.
5. Point a staging application at the restored database. Verify authentication/access, editor loads, saves, project history, checkpoint hydration and collaboration reconnect behavior before cutover. Resolve pending GitHub operations by reviewing actual remote/provider state; do not automatically replay them because their database record was recovered. Similarly review provider tokens and invitation expiry/revocation against current reality.
6. Record recovery timing and unresolved checks. Cut over only after validation and the deployment's operator approval procedure; keep the original database/backup available for rollback. Start application and realtime services with coordinated restored state and revision values, reconnect clients, and resume writers. Confirm writes and a fresh verified backup after cutover.

## Failure handling and remaining verification

- Missing binaries: install official tools, verify their versions/checksums, and set the process-only tool paths.
- Replica-set startup/election failure: inspect local server availability, permissions and ports. The verifier starts a new server rather than altering an existing instance.
- Archive/hash or restore failure: discard the incomplete disposable target and use an intact verified archive. Do not mark an erroring capture as the newest recovery point.
- Data/index/permission mismatch: keep cutover blocked and compare the selected archive, schema/version and namespace mapping.
- Application verifier failure: read the ignored diagnostic log and rerun the controlled fixture drill after fixing the actual failure. Inspect JSON `status`/`failedPhase` and cleanup checks.

Local rollback/recovery has now been verified on real MongoDB. Deployed backup scheduling, encrypted off-host transfer, managed-provider recovery, realistic-size restore timing, OAuth/provider reauthorization, distributed Redis/WebSocket/browser reconnect, and production cutover remain deployment/operations checks. No live database, `.env.local`, production schema or remote provider was modified by this milestone.

Additional local checks passed: **13 isolation/integrity tests**, repository lint, and application/collaboration type checking. The five application tests passed inside the real recovery drill and were visibly skipped by the ordinary test command without its isolated URI. No UI or production runtime code changed, so no new browser or production build result is claimed for Day 27.

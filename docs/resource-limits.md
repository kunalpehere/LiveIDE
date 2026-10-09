# Resource limits (Day 24)

LiveIDE bounds persisted project content, named snapshots, collaboration checkpoints, AI chat and terminal memory. The application policy is in `lib/resource-limits.ts`; directory scanners, GitHub imports and publishing use the same source limits.

| Resource | Limit | Behavior and recovery |
| --- | --- | --- |
| Text file | 256 KiB in UTF-8 | Reduce or remove the file before saving/importing. |
| Project files | 250 | Remove unused files or import a smaller folder. |
| Project source content | 2 MiB in UTF-8, summed across files | Reduce content or remove files. |
| Serialized project JSON | 3 MiB in UTF-8, including escaping/metadata | Reduce content or metadata. Separate allowance prevents JSON overhead from consuming the source-content budget. |
| Folders | 500 including root; 20 nested folder levels | Remove empty folders or flatten nesting. |
| Named snapshots | 50 per project, including automatic restore points | Owner deletes unused snapshots. No snapshots are automatically evicted. |
| Snapshot content | Same source/tree/JSON limits as saves | Reduce saved content before creating a snapshot. Oversized legacy snapshots cannot be restored. |
| Collaboration checkpoint | 2 MiB of decoded CRDT state | Reduce project content; checkpoint size includes CRDT history, not just visible text. |
| Project checkpoints | 251 documents, 8 MiB total decoded state | Owner saves and restores a named snapshot to clear source checkpoints. Notes survive source restoration. |
| AI request body | 32,000 bytes | Send less context or a shorter question. Actual streamed body bytes are checked even without Content-Length. |
| Chat input | 12,000 characters; at most 10 context messages of 4,000 characters each | Shorten the question/context. The request-body byte limit also applies. |
| AI output | 64 KiB per message | Ask a narrower question or request sections. Oversized generated answers are rejected; streams stop with an explanatory notice. |
| Chat history | Latest 100 messages per user and project | Older messages are removed transactionally when a new message is persisted. The UI announces retention and bounds its message list. Export retained messages before they roll out of history. |
| Provider JSON / stream record buffer | 512 KiB | Reject oversized provider payloads rather than buffering unbounded responses. |
| Terminal scrollback | 1,000 lines | Older lines roll out of the terminal. |
| Pending terminal output | 128 Ki UTF-16 code units (at most 256 KiB) | Keep newest output and display an omission notice; clear/download controls use retained output. |
| Terminal batch | 16 Ki UTF-16 code units | One parser write at a time, yielding between batches. |
| Terminal commands | 200 retained commands, 4,096 characters per input | Bounded command history and input. |
| Shared runtime feed | 40 sanitized events | Event labels only; raw shell logs are not broadcast or persisted. |

The chat client reduces older prompt context to fit the request-byte budget while keeping the newest messages. If the current question and attachments alone exceed the budget, it explains how to shorten them before sending a request. This prompt-context trimming is separate from the 100-message storage retention window.

## Enforcement and data preservation

Save validates resources on the client for immediate feedback and independently on the server before any template write. Validation traverses iteratively before recursive schema parsing, rejecting excessive nesting, cycles and malformed trees. Duplicate validates existing saved content before creating the copy. Starter templates are bounded by the directory scanner. GitHub import reviews validate before creating a project; publishing validates the saved tree before provider mutations.

Snapshot creation and restoration validate content and check capacity inside a transaction. A write to the project row fences concurrent snapshot inserts, preventing simultaneous requests from exceeding the count. A restore requires a free slot for its safety snapshot. Failure rolls back revision changes and leaves current content/checkpoints intact. Ask the owner to delete an unused snapshot when capacity is full.

Chat insert/pruning and checkpoint aggregate checks also contend on the project row inside their transactions. Database conflicts may require retrying; a conflicting transaction cannot commit unchecked growth. Chat history reads return the newest window in chronological order and scope it to the current user and accessible project. A failed AI response leaves the submitted user message available but does not persist an oversized assistant message. A stream stopped at the cap is visibly marked and its partial assistant answer is not saved.

Existing projects remain readable and are not automatically trimmed. They must satisfy the policy for their next save, duplicate or snapshot/restore. These limits do not impose a user account project-count quota. History event retention, immutable snapshot semantics, storage migrations and recovery drills remain Days 25–27.

Persisted JSON objects and serialized trees are supported when loading saved projects and reviewing GitHub changes. Reload uses saved content rather than falling back to a starter template for object-valued storage. No database schema migration is introduced.

Next.js action transport is capped at 4 MiB to accommodate the 3 MiB JSON policy plus transport overhead. Requests exceeding the framework transport cap can be rejected before application validation; ordinary UI saves validate first. Collaboration request JSON is read incrementally with a 3 MiB cap before protocol parsing. Checkpoint caps bound durable state; WebSocket frame and presence controls continue to use their existing protocol limits. Unsaved realtime edits can exceed the save policy and must be reduced before saving.

## Verification

- Full suite: **433 tests across 69 files passed**, run with one worker to avoid collaboration service startup deadline failures under competing process load.
- Lint and application/collaboration TypeScript checks passed. A malformed cached Next.js development validator was removed before regenerating types; application source needed no type-error repair.
- Final production build passed using process-only production-safe verification settings. `.env.local` was unchanged; no live database migration, deployment, repository commit or push was performed.
- Browser checks: all four guest workflow scenarios passed, plus the resource-limit save/reduce/reload scenario passed in an isolated run. The latter allows two minutes for cold Monaco loads. Browser verification used the existing development configuration with only its required development server and a longer startup allowance; no permanent runner configuration change was needed.

Boundary tests cover exact and exceeded file/count/content/depth/JSON limits, multibyte UTF-8 content, request streams with misleading Content-Length, snapshot capacity and oversized restore rejection, chat retention and isolation, generated/streamed responses, checkpoint size/count/aggregate limits, and terminal overflow. Integration tests assert rejected mutations do not write template, snapshot or checkpoint content.

The browser resource-limit scenario verifies an oversized edit produces remediation, preserves its draft, and can be reduced, saved and reloaded. Production MongoDB transaction contention and real provider deployment remain rollout checks; development fixtures and mocked providers cannot establish production database behavior.

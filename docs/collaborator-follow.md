# Collaborator follow mode — Day 16

Choose an online participant in **Follow collaborator** above the editor. LiveIDE opens their active file and follows their cursor, selection (including backwards selections), and vertical/horizontal scroll. Owners, editors, and viewers can follow. **Stop following** returns control immediately.

Opening or closing a file/tab, clicking in the editor, using its keyboard, or scrolling with a wheel/touch gesture stops following. Programmatic navigation caused by follow mode does not stop it. Following also stops when either side disconnects, loses access, closes its active file, or when the followed participant starts following someone else. Follow chains are deliberately unavailable to avoid feedback loops. A missing/deleted target file stops following with an explanation.

Follow actions only open an existing file and update Monaco selection/scroll. They never write content, save files, install dependencies, or control the runtime. Opening an already open file preserves its draft. Monaco retains its existing models and undo history across file switches. Ordinary collaboration edits still arrive through the existing per-file CRDT channel.

Open files retain their collaboration sessions and model bindings until closed or the workspace unmounts. This prevents navigation from closing a socket while an edit is waiting for server authorization, and avoids replacing a retained model with an older snapshot on return. Inactive file presence is hidden, while normal collaborative text updates continue to refresh that file's draft. Closing files releases their sessions; leaving the project releases all of them. File identities preserve full paths, including duplicate basenames in different folders.

Collaborating viewers receive their content through the CRDT binding. The installed React Monaco wrapper calls `setValue` for every read-only controlled-value update, even when the text is equal, so viewer editors use an initial default value instead. This prevents normal incoming edits from generating unauthorized document echoes.

## Presence and authorization

A project/revision-wide channel uses the reserved `.liveide/presence` path in the existing versioned transport. This separates presence from file rooms, so a participant remains discoverable while switching files. Closing the last file unmounts the editor and leaves the presence channel. The server enforces an awareness-only channel for every role. It skips file hydration and checkpoint writes; the snapshot endpoint also rejects this reserved path. Redis relays its ephemeral awareness through the existing room subscription mechanism, and rejects document-update relay frames for this channel.

The channel uses normal signed tokens, token renewal, revision checks, and active membership checks. Presence identity must match the token's user, name, and color, and each socket owns one unclaimed awareness ID. Selection coordinates, file paths, and scroll offsets are bounded and validated. Presence traffic retains the existing leading/trailing 50 ms throttle. Remote positions are clamped to the local model when file contents differ.

Access changes are detected by the existing authorization watcher (five-second polling for idle sockets), then awareness removal stops following. Offline/reconnecting sessions discard remote participants and require a new explicit choice after recovery.

## Development snapshot fix

The development mock lacked `templateFile.findFirst`, which the snapshot GET route uses. This produced a `TypeError` during room hydration. The mock now provides that delegate. Its delegate object and captured fixture records are shared within the server process, so independently bundled routes and server actions see invitations and revocations consistently. New mock projects have no saved template placeholder, so both the editor and collaboration hydrate the actual starter source instead of treating missing placeholder files as empty. A route regression uses the actual mock database and starter service, and the dedicated browser scenario exercises real snapshot hydration and authenticated collaboration without transport test mode. The editor and terminal are imported with server rendering disabled because their bindings/add-ons require browser globals.

## Verification

Locally verified on October 7, 2026: all 241 tests across 48 files passed, along with lint, application/transport type checks, and the production build. Browser verification passed 12 existing scenarios and the dedicated owner/viewer follow scenario. The opt-in live preview, terminal flood, and startup benchmark scenarios were skipped. Hosted CI, live MongoDB, distributed Redis, and deployed checks were not run. Temporary test services were stopped.

Run the normal lint, application/transport type checks, unit suite, and production build. Run the real owner/viewer browser scenario separately:

```bash
npx playwright test --config playwright.collaboration.config.ts
```

This configuration starts an isolated development app on port 3100 and an authorization-enforcing collaboration service on port 1235. It supplies process-local test settings and does not edit `.env.local`. The scenario uses the runtime compatibility gate to avoid unrelated dependency installations in its two browsers; runtime execution has separate browser scenarios. The test covers cross-file following, backwards selections, scroll, explicit/local exit, viewer access, disconnect/removal, and retained editor models/drafts/undo.

Unit checks cover exact file paths, bounded presence, identity spoofing, draft retention, follow chains, intentional navigation, and lifecycle cleanup. Existing collaboration transport/recovery/authorization checks remain applicable. Distributed Redis, live MongoDB behavior, and deployed performance require separate deployment verification.

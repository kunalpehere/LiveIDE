# Collaborative project notes — Day 18

Open **Notes** in the workspace header to edit shared Markdown instructions, decisions, and TODOs. Owners and editors can edit; viewers can read. **Preview notes** shows formatted Markdown. The Notes panel works even with no source file open. Closing the panel or switching to preview keeps its session and Monaco model alive until the workspace exits, so file switches and panel toggles do not discard pending changes.

Notes use their own Yjs document, Monaco model URI, awareness, connection status, and retry lifecycle. They do not enter the source-file explorer, draft store, saved template, source snapshots, runtime filesystem, AI suggestions, or live-preview build pipeline. Changes converge independently of which source file is active. Source drafts and undo history remain in their existing models.

## Rooms, permissions, and persistence

The reserved `.liveide/notes` document has a stable room at revision 1. Source documents and follow presence still use the project's current source revision. Token issuance, access checks, and checkpoint validation explicitly distinguish notes from source revisions. Restoring a code snapshot preserves the notes checkpoint and keeps the notes room authorized; deleted projects and changed/removed memberships still invalidate it. Existing signed-token expiry, role enforcement, per-update authorization, frame bounds, Redis relay, and idle access checks apply to notes.

The collaboration service hydrates notes from `CollaborationDocument` checkpoints, initially as empty Markdown instead of starter source. It uses the existing debounced checkpoint interval (1.5 seconds after changes) and shutdown persistence. No new database model or schema rollout is needed for Day 18. Checkpoints persist through reopening the workspace and service restarts. Source restore deletes only source/presence checkpoints and retains notes.

The UI reports connected/shared-live status rather than claiming each edit is durably saved. Checkpoints are asynchronous; a crash before persistence can lose recent edits, as with source collaboration. Offline edits remain in the open tab and merge on reconnection. The editor is locked until initial hydration completes, and after an access/session failure. A failed connection offers retry; changed role/identity requires a workspace reload under the existing session policy. A browser unload warning protects known unsent offline edits. Closing the tab while offline still loses those edits if the warning is ignored; there is no browser-disk draft persistence.

When collaboration is not configured, Notes displays an unavailable explanation instead of offering an unsaved local document. Development mock checkpoints survive within the running app process; production uses the existing MongoDB persistence.

## Markdown safety

Preview uses `react-markdown` and GFM, with raw HTML skipped and no raw-HTML plugin. Only HTTP, HTTPS, mailto, and relative links are allowed; other schemes are rendered without an active link. Links open with `noopener noreferrer`. Images render as alt-text placeholders, so preview does not load remote tracking images. No notes text is executed. Preview rendering is limited to the first 100,000 characters without truncating the underlying document.

## Verification

Locally verified on October 7, 2026: all 270 tests across 53 files passed, along with lint, application/transport type checks, and the final production build. Both dedicated collaboration browser scenarios passed with no page errors. The Notes preview screenshot was visually inspected, and temporary test services stopped. The browser fixture uses the runtime compatibility gate; runtime execution and opt-in runtime benchmarks were not rerun for Day 18. No live database change, commit, push, or deployment was performed.

Run lint, application/transport type checks, the unit suite, and production build. The dedicated real collaboration browser configuration now covers notes and collaborator follow mode:

```bash
npm run test:e2e:collaboration
```

Run only notes with `npx playwright test --config playwright.collaboration.config.ts e2e/notes-collaboration.spec.ts`.

Tests cover stable notes authorization across source restores, role revocation, initial hydration, model/session cleanup, offline drafts, read-only viewers, safe Markdown, and independent checkpoint persistence. The real-socket test exercises simultaneous edits, offline merge, a forged viewer update, source isolation, and a collaboration-server restart. The two-browser scenario exercises the actual Notes panel, hidden-panel synchronization, Markdown preview, preserved source drafts/models, checkpoint persistence, viewer downgrade/reload, and membership removal. Hosted CI, distributed Redis, live MongoDB durability, and crash/deployment behavior remain separate environment checks.

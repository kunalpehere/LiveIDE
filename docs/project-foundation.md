# LiveIDE project foundation

## Project summary

LiveIDE is a persistent browser-based development workspace for small teams. It allows users to create or import web projects, edit multiple files, collaborate in real time, run projects in an isolated browser runtime, inspect terminal output and live previews, and restore earlier project states.

The project is not intended to replace a complete desktop IDE or Git hosting provider. Its purpose is to reduce the setup and coordination cost involved in working on a web project together.

## Problem statement

Collaborative development commonly requires every participant to clone a repository, install the correct runtime and dependencies, configure environment variables, and resolve machine-specific issues before meaningful work begins. Screen sharing helps people observe one another, but it does not provide shared editing, independent navigation, access control, or durable recovery.

LiveIDE addresses this by combining the most important parts of a collaborative web-development session in one browser workspace:

- a persistent project and file tree;
- a professional code editor;
- conflict-free real-time editing;
- an executable browser runtime;
- terminal and preview feedback;
- role-based sharing;
- snapshots and project history.

## Why this project is worth building

The engineering challenge is broader than building an editor interface. LiveIDE requires several systems to agree about the same project:

- the database stores durable project state and permissions;
- Monaco manages the local editing experience;
- Yjs resolves concurrent text edits;
- the collaboration service distributes live updates and presence;
- WebContainers mount and run the project in the browser;
- Auth.js identifies users;
- server-side authorization decides who may read, edit, share, restore, or delete a project.

Building these boundaries correctly demonstrates frontend engineering, backend design, real-time systems, security, persistence, testing, and deployment trade-offs in one coherent product.

## Target users

The initial target user is a student, developer, interviewer, mentor, or small team that wants to open a web project and work together without reproducing a complete local environment on every machine.

The initial authorization model deliberately remains small:

| Role | Intended access |
| --- | --- |
| Owner | Full project control, sharing, history restoration, and deletion |
| Editor | Read and modify project files, collaborate, save, and run the project |
| Viewer | Read files, observe collaboration, terminal state, and preview without modifying the project |

Enterprise organizations, billing, platform-administrator consoles, and complex file-level policies are outside the current scope.

## Product objectives

1. Make the complete create, edit, run, share, collaborate, save, and restore journey reliable.
2. Keep ordinary editing usable when AI, Redis, or another optional integration is unavailable.
3. Enforce authorization on the server and collaboration boundary, never only in the interface.
4. Keep live presence separate from durable project and version history.
5. Provide predictable recovery after network loss, runtime failure, or an incorrect edit.
6. Measure responsiveness instead of claiming performance without evidence.
7. Maintain an understandable codebase with feature ownership and automated release checks.

## Non-goals for the current product stage

- Replacing VS Code or supporting its extension ecosystem
- Hosting production applications created inside LiveIDE
- Supporting dozens of server-side execution languages
- Voice and video conferencing
- Mobile-first coding
- Autonomous AI modification of entire projects
- Reimplementing GitHub
- Enterprise workspace administration and billing

These exclusions protect the reliability of the core collaboration workflow.

## Current capabilities

- Multi-file Monaco editor and file explorer
- React, Next.js, Vue, Angular, Express, and Hono starter projects
- WebContainer-powered Node.js runtime
- Integrated terminal and application preview
- Persistent projects using Prisma and MongoDB
- Auth.js authentication and development-only guest mode
- Owner, editor, and viewer authorization
- Yjs document collaboration and participant presence
- Optional Redis relay for multiple collaboration instances
- Named snapshots, restoration, revisioning, and history events
- Optional AI chat and manual inline completion
- Unit, integration, and Playwright test foundations

## Engineering principles

### Durable state before realtime convenience

Collaboration updates improve immediacy, but the database remains the durable source of project ownership, membership, saved content, snapshots, and history.

### Local-first editing

A keystroke should update the local editor immediately. Network delivery and persistence happen after the local edit and must not block typing.

### Server-authoritative permissions

Hidden buttons are not security controls. Every protected server action, route handler, and collaboration connection must validate identity and project access.

### Presence is ephemeral

Cursors, selections, online status, and follow state are short-lived collaboration signals. They are not permanent business records.

### Recovery is a feature

Network reconnection, save conflicts, runtime crashes, and snapshot restoration are expected states with explicit behavior, not exceptional afterthoughts.

### Optional systems degrade gracefully

AI is optional. Redis improves distributed collaboration. Their failure must not corrupt saved projects or prevent ordinary single-user editing.

### Features require proof

A feature is complete when its authorization, validation, failure states, tests, documentation, and observable behavior are complete—not when only its happy path works.

## Important technical decisions

### Why Monaco Editor?

Monaco provides a mature editor model, language services, selections, decorations, commands, and familiar behavior. Building these capabilities from a textarea would distract from the collaboration problem.

### Why Yjs?

Concurrent edits cannot safely be handled with last-write-wins saves. Yjs provides a CRDT that allows independently created edits to converge without a central locking workflow.

### Why WebContainers?

WebContainers can run Node.js projects inside a supported browser. This keeps untrusted project execution away from the LiveIDE application server and provides a real filesystem, process model, terminal, and preview rather than a simulated editor demo.

### Why MongoDB and Prisma?

The project contains structured relationships for users, memberships, history, and permissions, while project trees and collaboration snapshots contain document-shaped data. Prisma supplies a typed data-access layer and MongoDB fits the current project-content model. Explicit size limits and future per-file storage remain necessary as projects grow.

### Why a separate collaboration service?

Realtime WebSocket sessions are long-lived and have different scaling and failure behavior from web requests. The Next.js application handles product APIs and authorization; a separately deployed collaboration service owns live connections. This also avoids pretending that a persistent WebSocket process can run as a normal Vercel Function.

## Interview-ready explanation

### Thirty-second introduction

> LiveIDE is a persistent collaborative browser IDE for web projects. I built it to explore how a code editor, CRDT collaboration, browser execution, database persistence, role-based authorization, and version recovery work as one system. Users can create a project, edit multiple files in Monaco, run it through WebContainers, invite editors or viewers, collaborate through Yjs, and restore named snapshots. The main engineering focus is correctness across the boundaries between local editor state, realtime state, and durable state.

### What was the hardest problem?

The hardest problem is maintaining clear ownership of state. Monaco owns the immediate editing experience, Yjs owns concurrent text convergence, WebContainers own the running filesystem and processes, and MongoDB owns durable product state. Treating any one of these as the source of truth for everything causes lost edits, unnecessary rerenders, or inconsistent restoration.

### How are concurrent edits handled?

Each collaborative file is represented by a Yjs document. Local Monaco changes become CRDT updates, which are sent through the collaboration service. Remote updates are applied without replaying them as new local edits. State-vector synchronization should transfer only missing changes during connection or recovery.

### How is security enforced?

Authentication identifies the user, but project authorization is checked independently for protected operations. Owner, editor, and viewer capabilities are derived server-side. Collaboration clients receive short-lived signed access tokens, and the collaboration service must enforce the token's project, room, user, role, and expiry claims.

### Why not run the collaboration server on Vercel?

Vercel is appropriate for the Next.js web application and request-driven functions. A collaboration server needs long-lived WebSocket connections and process-level room state, so it should run on a long-lived container or realtime platform. Redis can relay updates between collaboration instances, while MongoDB stores durable checkpoints.

### Why does LiveIDE use WebContainers instead of a remote execution API?

The initial scope is complete JavaScript web projects rather than isolated snippets in many languages. WebContainers provide fast browser-local execution and keep project code away from the application backend. Remote execution may be added later as a separate sandboxed service if the use case justifies its security and operational cost.

### How is AI used responsibly?

AI is an optional assistant rather than a dependency of the editor. It is disabled without an explicitly configured provider, uses validated and size-limited requests, applies timeouts, and requires manual suggestion acceptance. Editing, saving, collaboration, and runtime execution continue without it.

### How would the system scale?

The web application can scale independently on Vercel. Collaboration instances use a managed Redis relay for live cross-instance delivery and MongoDB checkpoints for recovery. Scaling decisions should be driven by measured room count, update rate, persistence latency, and runtime boot performance rather than prematurely splitting every module into a service.

## Definition of done

A LiveIDE feature is complete when:

- its user-visible behavior and scope are documented;
- loading, empty, error, offline, and unauthorized states are handled;
- server inputs are validated;
- authorization is enforced at every relevant boundary;
- high-frequency interactions do not cause unnecessary application rerenders;
- cleanup and reconnection behavior are defined;
- unit, integration, contract, or end-to-end tests cover the appropriate risk;
- operationally important failures are observable;
- the relevant documentation is updated;
- the clean CI pipeline passes.

## Resume description

**LiveIDE — Collaborative Browser Development Workspace**
Built a full-stack browser IDE using Next.js, React, Monaco, WebContainers, Yjs, Prisma, MongoDB, and Auth.js. Implemented multi-file project execution, live preview and terminal output, CRDT-based realtime editing, owner/editor/viewer authorization, persistent collaboration checkpoints, snapshot restoration, and optional AI assistance. Designed the realtime service for independent deployment and Redis-backed multi-instance communication, with automated authorization, collaboration, history, runtime, and end-to-end tests.

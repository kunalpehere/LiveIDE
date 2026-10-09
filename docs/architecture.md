# LiveIDE system architecture

## Architecture goals

The architecture separates four kinds of state that have different consistency and lifecycle requirements:

1. **Product state:** users, projects, membership, snapshots, and history.
2. **Editor state:** open files, selections, models, unsaved local changes, and layout.
3. **Collaboration state:** CRDT updates, presence, cursors, and active-file awareness.
4. **Runtime state:** mounted files, processes, terminal streams, preview URLs, and failures.

Keeping these boundaries explicit is the central architectural rule of LiveIDE.

## Production topology

```mermaid
flowchart LR
    User["Browser client"]
    Web["Next.js application on Vercel"]
    Collab["Long-running collaboration service"]
    Mongo["MongoDB Atlas"]
    Redis["Managed Redis"]
    GitHub["GitHub API"]
    AI["Optional AI provider"]
    WC["WebContainer in browser"]

    User -->|HTTPS| Web
    User <-->|WSS + signed token| Collab
    User --> WC
    Web -->|Prisma| Mongo
    Collab -->|checkpoints| Mongo
    Collab <-->|Pub/Sub| Redis
    Web -->|optional| GitHub
    Web -->|optional| AI
```

The collaboration process must not be deployed as a normal Vercel Function. It requires a host that supports long-lived WebSocket connections. Redis is optional for a single instance and required when multiple collaboration instances serve active rooms.

## Application modules

```mermaid
flowchart TB
    Routes["App Router pages and API routes"]
    Auth["Authentication and authorization"]
    Projects["Projects and file persistence"]
    Editor["Monaco editor and file explorer"]
    Realtime["Yjs collaboration client"]
    Runtime["WebContainer runtime"]
    History["Snapshots and history"]
    Assistant["Optional AI gateway"]
    Data["Prisma data access"]

    Routes --> Auth
    Routes --> Projects
    Routes --> Editor
    Editor <--> Realtime
    Editor <--> Runtime
    Projects --> Data
    History --> Data
    Auth --> Data
    Assistant --> Auth
    Assistant --> Data
```

## Project opening flow

```mermaid
sequenceDiagram
    actor User
    participant Page as Next.js page
    participant Auth as Authorization
    participant DB as MongoDB via Prisma
    participant Editor as Monaco/File Explorer
    participant Runtime as WebContainer
    participant Realtime as Collaboration service

    User->>Page: Open project URL
    Page->>Auth: Resolve authenticated user
    Auth->>DB: Check owner or membership
    DB-->>Page: Project metadata, content, role, version
    Page-->>Editor: Render authorized project
    Editor->>Runtime: Mount project files
    Runtime->>Runtime: Install dependencies and start process
    Runtime-->>Editor: Terminal output and preview URL
    Editor->>Page: Request collaboration token
    Page->>Auth: Recheck project access
    Page-->>Editor: Short-lived signed token
    Editor->>Realtime: Connect and join file room
    Realtime-->>Editor: Missing CRDT updates and presence
```

Authorization is checked before project data is returned and again before realtime access is granted. Proxy or page redirects alone are not security boundaries.

## Collaborative editing flow

```mermaid
sequenceDiagram
    participant A as Editor A
    participant S as Collaboration service
    participant B as Editor B
    participant P as Persistence checkpoint

    A->>A: Apply keystroke locally
    A->>S: Send Yjs update
    S->>S: Apply update to room document
    S-->>B: Broadcast incremental update
    B->>B: Apply as remote-origin update
    S->>P: Persist batched checkpoint
    P-->>S: Acknowledge durable state
```

Typing must never wait for the database. Persistence is batched and recoverable. Remote updates must be tagged so they are not emitted again as new local operations.

## Save and conflict flow

```mermaid
flowchart TD
    Save["User or autosave requests save"] --> Validate["Validate project ID and file tree"]
    Validate --> Authorize["Require owner or editor role"]
    Authorize --> Compare{"Expected version matches?"}
    Compare -->|Yes| Persist["Persist content and increment version"]
    Compare -->|No| Conflict["Return explicit save conflict"]
    Persist --> Success["Return new durable version"]
    Conflict --> Resolve["Reload, merge, or restore deliberately"]
```

The version check prevents a stale browser session from silently replacing newer durable content.

## Snapshot restoration flow

```mermaid
flowchart TD
    Request["Owner/editor selects snapshot"] --> Permission["Verify restoration permission"]
    Permission --> Snapshot["Load immutable snapshot"]
    Snapshot --> NewState["Write snapshot as new current state"]
    NewState --> Revision["Increment collaboration revision"]
    Revision --> Reset["Invalidate old collaboration rooms"]
    Reset --> Audit["Record restore history event"]
    Audit --> Clients["Clients reconnect to the new revision"]
```

Restoration creates new history; it does not erase the intervening history. Revisioning prevents clients attached to an older collaborative room from overwriting the restored state.

## Runtime flow

```mermaid
stateDiagram-v2
    [*] --> Unsupported: Browser lacks required capabilities
    [*] --> Booting: Supported browser
    Booting --> Mounting
    Mounting --> Installing
    Installing --> Starting
    Starting --> Ready
    Ready --> Running
    Running --> Ready: Process exits normally
    Booting --> Failed
    Mounting --> Failed
    Installing --> Failed
    Starting --> Failed
    Running --> Failed: Runtime/process crash
    Failed --> Booting: Retry
```

The UI should expose these states rather than showing an indefinite generic loader. A runtime failure must not destroy editor state.

## Deployment responsibilities

| Component | Responsibility | Suitable host |
| --- | --- | --- |
| Next.js application | Pages, API routes, server actions, authentication, authorization | Vercel |
| Collaboration service | WebSockets, Yjs rooms, presence, checkpoint coordination | Render, Railway, Fly.io, Cloud Run, or equivalent |
| MongoDB | Durable product and collaboration state | MongoDB Atlas |
| Redis | Cross-instance realtime relay and distributed limits | Managed Redis |
| WebContainer | User project execution | Supported browser |
| AI provider | Optional chat and completion generation | External provider or separately hosted service |

## Trust boundaries

```mermaid
flowchart LR
    Browser["Untrusted browser input"] --> Web["Validated web boundary"]
    Browser --> Collab["Signed collaboration boundary"]
    Web --> DB["Restricted database credentials"]
    Collab --> DB
    Browser --> Sandbox["Untrusted project code in WebContainer"]
    Web --> Provider["Limited outbound provider requests"]
```

- Browser-provided roles, user IDs, project IDs, filenames, and file contents require validation.
- Collaboration tokens should be short-lived and scoped to one project revision/room and role.
- Development guest authentication and mock data must fail closed in production.
- Project code must not execute inside the Next.js or collaboration processes.
- Secrets must never be copied into the WebContainer filesystem or AI prompt context.

## Performance strategy

### Editor

- Keep Monaco models stable when panels open or close.
- Avoid storing every keystroke in broad React state.
- Use refs or external services for high-frequency editor and runtime objects.
- Lazy-load Monaco and optional secondary panels.

### Collaboration

- Transfer incremental Yjs updates rather than whole documents.
- Throttle cursors, selections, pointers, and scroll state independently.
- Batch durable checkpoints.
- Reconnect with backoff and state-vector resynchronization.

### Runtime

- Reuse a WebContainer session for the active project.
- Avoid reinstalling unchanged dependencies.
- Bound terminal output retained in memory.
- Keep preview and terminal failures isolated from editing.

### Data

- Query only the fields required by each view.
- Paginate growing project, history, member, and chat collections.
- Establish project size, file count, snapshot count, and message limits.
- Measure queries before adding caches.

## Availability and graceful degradation

| Failure | Expected behavior |
| --- | --- |
| AI provider unavailable | Editing, collaboration, saving, and runtime continue |
| Redis unavailable in a single-instance environment | Collaboration continues in documented single-instance mode |
| Redis unavailable in distributed production | Readiness should fail or traffic should be restricted to prevent split rooms |
| Collaboration connection lost | Local edits remain available and client reconnects/resynchronizes |
| WebContainer fails | Editor and durable project remain usable; retry is offered |
| Database unavailable | Destructive or durable operations fail safely; no false success is shown |

## Architecture evolution rule

LiveIDE should remain a modular application plus one dedicated realtime service until measured load or ownership boundaries justify additional services. GitHub integration, remote execution, and AI may use separate providers, but the codebase should not be split into microservices merely to appear sophisticated.

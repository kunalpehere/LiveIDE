# Collaboration performance suite

Day 11 adds repeatable correctness scenarios and separate timing observations for the real standalone collaboration service. It establishes a measured baseline for later editor/runtime optimization.

## Run and reproduce

```bash
npm test
npm run verify:collaboration:performance
```

The verifier runs 2-, 5-, and 10-client scenarios sequentially and writes `reports/collaboration-performance.json`. CI runs it and uploads that report. Reports are ignored by Git; reviewed baseline numbers are recorded here. No database, Redis, cloud account, or production credentials are needed. The harness starts isolated loopback services on temporary ports, signs fixture tokens, and cleans up its sockets, documents, processes, and HTTP connections.

Each scenario uses the actual versioned transport and standalone server, with BroadcastChannel disabled and Day 10 authorization enabled. An authenticated local HTTP fixture provides current access and checkpoints. Clients have fixed Yjs IDs and follow a fixed edit schedule:

1. Synchronize a shared baseline.
2. Run five rounds in which every client inserts a unique marker before network delivery can interleave with the local task.
3. Check equal text and state vectors after each round, and exactly one copy of every marker.
4. Disconnect all clients, perform overlapping deletions and unique offline insertions, then reconnect.
5. Compare every recovered document with an independent Yjs oracle that merges client states in reverse order; check exact length, deletion, and marker preservation.
6. Check the expected live socket count and measure five control ping round trips per client.

Correctness assertions fail for lost/duplicated edits, divergent state, missing samples, unexpected socket counts, rejected traffic, or leaked secrets. Timing values do not have machine-dependent pass/fail thresholds. Fixed operations make the scenario repeatable; OS scheduling, generated server IDs, connection order timing, and measured latency are not deterministic.

## Measurement boundaries

| Metric | Measures | Excludes or limitations |
| --- | --- | --- |
| Server processing | Incoming frame decoding/validation plus synchronous Yjs application, listeners, encoding, and broadcast dispatch. | Authorization HTTP wait, time waiting in the mutation queue, asynchronous persistence/Redis delivery, and network transmission. |
| Authorization | Awaited current-access check before a document mutation. | Queue wait and subsequent application. Fixture calls use local HTTP rather than production database queries. |
| Network round trip | WebSocket control ping to matching pong, using one client's monotonic clock. | A control-path RTT includes event-loop/socket overhead; it is not pure wire latency, an edit acknowledgment, or a storage acknowledgment. |
| Client application | Synchronous provider processing of incoming sync step 2/update messages after frame validation. | Decode cost, later paint and asynchronous work. Benchmark clients run Node/Yjs without Monaco; the browser view includes synchronous bound Monaco listeners. |
| Round convergence | Local edit start until all clients have equal text/state vectors. | Observed with 10 ms polling; includes authorization, scheduling, delivery, and application. It is not one-way network latency. |

Each timing window retains at most 256 samples. Lifetime count is separate from window sample count. Mean and nearest-rank p50/p95/max cover that window. Samples include initial synchronization and reconnect handshakes; there is no warm-up exclusion. Server samples are per processed mutation, while client samples are per received mutation and depend on fan-out. These distributions should not be added together as an end-to-end latency estimate.

## Initial local baseline

Measured October 6, 2026, on Windows with Node 22.14.0, loopback WebSocket, a local authority/checkpoint fixture, and no Redis. Each run used tiny marker edits and five concurrent rounds. Every scenario converged with zero lost updates. Values below are milliseconds, rounded to three decimals.

| Clients | Concurrent + offline edits | Server processing p95 | Authorization p95 | Control RTT p95 | Highest client apply p95 |
| --- | --- | --- | --- | --- | --- |
| 2 | 10 + 2 | 1.851 | 9.828 | 1.854 | 4.991 |
| 5 | 25 + 5 | 1.761 | 10.949 | 0.504 | 0.354 |
| 10 | 50 + 10 | 2.671 | 36.658 | 0.822 | 0.302 |

The two-client cold application outlier illustrates why this small sample is a baseline, not a scaling prediction or service-level objective. The growing authorization cost warrants later investigation with real database access and sustained load; this milestone preserves the security checks.

## Development diagnostics view

In `npm run dev`, open a source file and expand **Collaboration diagnostics** at the bottom left of the editor. **Refresh measurements** snapshots local client application timing and requests current service measurements. It shows connection state, client/server/authorization p50/p95, active server sockets, and an application-server HTTP probe duration. The probe is labeled separately and does not stand in for browser WebSocket RTT. With collaboration disabled, the view reports no local samples and unavailable server metrics.

The view refreshes on demand, keeping high-frequency samples out of React state. Samples belong to the mounted file session and reset when that session is replaced; the service aggregates its process until restart. No document content, user identities, tokens, paths, or machine details appear in service metrics.

The application diagnostics route requires current project access and exists only in development. It forwards the independent service secret server-side to the fixed configured collaboration service. The standalone `/diagnostics` endpoint requires that secret and returns 404 in production. Production builds omit the view and browser timing callbacks; the server also omits timing collection. Existing protocol versions and application frame shapes are unchanged.

## Limits and remaining deployment verification

This does not establish public-internet latency, sustained-load capacity, large-document behavior, multi-process Redis convergence, database checkpoint durability, browser paint performance, or mobile/background-tab behavior. Authority and checkpoint fixtures do not replace MongoDB transaction validation. The 2/5/10 clients run in one Node process against another local Node process, so machine contention affects all measurements. Repeat the verifier on comparable environments before comparing trends; run real browser and deployed Redis/database scenarios before making production performance claims.

On October 6, 2026, the full 151-test suite passed, followed by an additional standalone production diagnostics guard test (152 tests exercised in total). Lint, application/shared-transport type checking, the production build, all ten Chromium browser regressions, the performance verifier, and checkpoint restart recovery passed. The browser suite exercised the diagnostics view and unavailable-service feedback. Production endpoint tests confirmed that the application route is disabled before service calls and that the standalone endpoint returns 404 even with a valid service secret. CI changes are configured here; a hosted GitHub Actions run has not been executed from this workspace.

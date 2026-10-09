import { mkdir, writeFile } from "node:fs/promises";
import { runCollaborationPerformance } from "./collaboration-performance.mjs";

const result = await runCollaborationPerformance();
await mkdir("reports", { recursive: true });
await writeFile("reports/collaboration-performance.json", JSON.stringify(result, null, 2) + "\n");
console.table(result.scenarios.map(scenario => ({ clients: scenario.clients, lostUpdates: scenario.lostUpdates,
  serverP95Ms: scenario.serverProcessing.p95Ms.toFixed(3), authorizationP95Ms: scenario.authorization.p95Ms.toFixed(3),
  rttP95Ms: scenario.networkRoundTrip.p95Ms.toFixed(3), clientApplyMaxP95Ms: Math.max(...scenario.clientApplication.map(timing => timing.p95Ms)).toFixed(3) })));
console.log("Report: reports/collaboration-performance.json");

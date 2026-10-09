import { db } from "./db";
import { getDatabaseConfiguration, getCollaborationConfiguration } from "./runtime-config.mjs";
import { probe, summarizeHealth, type DependencyHealth } from "./health";

// Coalesce concurrent probes and briefly cache results to bound public traffic.
let pending: Promise<DependencyHealth> | undefined;
let cached: { value: DependencyHealth; expires: number } | undefined;
let databaseOperation: Promise<unknown> | undefined;
export function databaseHealth(): Promise<DependencyHealth> {
  if (getDatabaseConfiguration().useMockDb) return Promise.resolve({ status: "degraded", code: "DEVELOPMENT_MOCK" });
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
  if (pending) return pending;
  pending = probe("database", () => {
    if (!databaseOperation) {
      databaseOperation = db.$runCommandRaw({ ping: 1, maxTimeMS: 1500 });
      void databaseOperation.then(() => { databaseOperation = undefined; }, () => { databaseOperation = undefined; });
    }
    return databaseOperation;
  }).then(value => {
    cached = { value, expires: Date.now() + 5000 };
    return value;
  }).finally(() => { pending = undefined; });
  return pending;
}

let collaborationPending: Promise<DependencyHealth> | undefined;
let collaborationCached: { value: DependencyHealth; expires: number } | undefined;
function collaborationHealth(): Promise<DependencyHealth> {
  const { websocketUrl } = getCollaborationConfiguration();
  if (!websocketUrl) return Promise.resolve({ status: "disabled", code: "NOT_CONFIGURED" });
  if (collaborationCached && collaborationCached.expires > Date.now()) return Promise.resolve(collaborationCached.value);
  if (collaborationPending) return collaborationPending;
  collaborationPending = (async () => {
    const url = new URL(websocketUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/readyz`;
    let result: DependencyHealth = { status: "unavailable", code: "PROBE_FAILED" };
    const transport = await probe("collaboration", async () => {
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(1800) });
      if (!response.ok) throw new Error("Collaboration not ready");
      const body = await response.json();
      if (body.service !== "liveide-collaboration" || !["healthy", "degraded"].includes(body.status)) throw new Error("Invalid readiness response");
      result = { status: body.status, code: body.status === "healthy" ? "READY" : "DEPENDENCY_DEGRADED" };
    });
    return transport.status === "healthy" ? result : transport;
  })().then(value => {
    collaborationCached = { value, expires: Date.now() + 5000 };
    return value;
  }).finally(() => { collaborationPending = undefined; });
  return collaborationPending;
}

export async function applicationHealth(storageOnly = false) {
  const [database, collaboration] = await Promise.all([databaseHealth(), storageOnly ? undefined : collaborationHealth()]);
  return summarizeHealth(database, collaboration);
}

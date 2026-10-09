import { logger } from "./logger";

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "disabled";
export interface DependencyHealth { status: HealthStatus; code: string }

export async function probe(dependency: string, operation: () => Promise<unknown>, timeoutMs = 2000): Promise<DependencyHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Probe deadline exceeded")), timeoutMs);
    })]);
    return { status: "healthy", code: "READY" };
  } catch (error) {
    logger.warn("health.dependency.failed", { dependency, code: "PROBE_FAILED" }, error);
    return { status: "unavailable", code: "PROBE_FAILED" };
  } finally { clearTimeout(timer); }
}

export function summarizeHealth(database: DependencyHealth, collaboration?: DependencyHealth) {
  const status = database.status === "unavailable" ? "unavailable"
    : database.status === "degraded" || collaboration?.status === "unavailable" || collaboration?.status === "degraded" ? "degraded" : "healthy";
  return { status, httpStatus: status === "unavailable" ? 503 : 200,
    dependencies: { database, ...(collaboration ? { collaboration } : {}) } };
}

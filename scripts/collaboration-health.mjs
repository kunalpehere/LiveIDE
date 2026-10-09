/** @param {{ testMode: boolean, redisConfigured: boolean, redisReady: () => boolean, checkStorage: () => Promise<string> }} options */
export async function collaborationReadiness({ testMode, redisConfigured, redisReady, checkStorage }) {
  const redis = !redisConfigured ? "disabled" : redisReady() ? "healthy" : "unavailable";
  let storage = testMode ? "degraded" : "unavailable";
  if (!testMode) {
    try { storage = await checkStorage(); } catch { storage = "unavailable"; }
    if (!["healthy", "degraded"].includes(storage)) storage = "unavailable";
  }
  const status = redis === "unavailable" || storage === "unavailable" ? "unavailable" : storage === "degraded" ? "degraded" : "healthy";
  return { service: "liveide-collaboration", status, dependencies: { redis: { status: redis }, storage: { status: storage } } };
}

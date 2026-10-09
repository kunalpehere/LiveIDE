import type { Instrumentation } from "next";
import { writeLog, validId } from "./lib/observability.mjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getApplicationConfiguration } = await import("./lib/runtime-config.mjs");
    try {
      getApplicationConfiguration();
      writeLog("info", "application.started");
    } catch (error) {
      writeLog("error", "application.startup.failed", { code: "INVALID_CONFIGURATION" }, error);
      throw error;
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const incoming = request.headers["x-request-id"];
  writeLog("error", "server.request.failed", {
    requestId: validId(incoming) ? incoming : crypto.randomUUID(),
    route: context.routePath, routeType: context.routeType, method: request.method,
    digest: typeof error === "object" && error !== null && "digest" in error ? error.digest : undefined,
  }, error);
};

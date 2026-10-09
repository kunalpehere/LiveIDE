import "server-only";

import type { ActionResult } from "@/lib/errors";
import { actionSuccess, errorDetails } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";
import { validId } from "@/lib/observability.mjs";
import { requestContext } from "@/lib/request-context";

export async function runPlaygroundAction<T>(operation: string, action: () => Promise<T>): Promise<ActionResult<T>> {
  let requestId = requestContext.getStore()?.requestId;
  if (!requestId) {
    // Tests and non-request callers have no Next.js request headers.
    let incoming: string | null = null;
    try { incoming = (await headers()).get("x-request-id"); } catch { /* Outside a Next.js request. */ }
    requestId = validId(incoming) ? incoming! : crypto.randomUUID();
  }
  return requestContext.run({ requestId }, async () => {
  try {
    const data = await action();
    return actionSuccess(data);
  } catch (error) {
    const details = errorDetails(error);
    if (details.status < 500) logger.warn("playground.action.rejected", { operation, code: details.code });
    else logger.error("playground.action.failed", { operation, code: details.code }, error);
    return { success: false, code: details.code, message: details.message, requestId };
  }
  });
}

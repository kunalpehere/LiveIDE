import "server-only";

import type { ActionResult } from "@/lib/errors";
import { actionSuccess, errorDetails } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function runPlaygroundAction<T>(operation: string, action: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await action();
    return actionSuccess(data);
  } catch (error) {
    const details = errorDetails(error);
    if (details.status < 500) logger.warn("playground.action.rejected", { operation, code: details.code });
    else logger.error("playground.action.failed", { operation, code: details.code }, error);
    return { success: false, code: details.code, message: details.message };
  }
}

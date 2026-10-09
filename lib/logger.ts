import { writeLog } from "./observability.mjs";
import { requestContext } from "./request-context";

type LogContext = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, context: LogContext = {}, error?: unknown) {
  writeLog(level, event, { ...context, ...requestContext.getStore() }, error);
}

export const logger = {
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext, error?: unknown) => write("warn", event, context, error),
  error: (event: string, context?: LogContext, error?: unknown) => write("error", event, context, error),
};

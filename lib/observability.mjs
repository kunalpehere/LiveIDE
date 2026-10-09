// Shared by the Next.js server and the standalone collaboration process.
// Only explicitly permitted metadata is emitted. Raw errors, URLs, headers,
// user identities, source code, and arbitrary context are never serialized.
const identifiers = new Set(["requestId", "eventId", "pageRequestId"]);
const labels = new Set(["code", "source", "phase", "dependency", "status", "method", "routeType", "operation"]);
const numbers = new Set(["httpStatus", "durationMs"]);
export const errorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "UnsupportedRuntimeError", "RuntimeConfigurationError"]);

/** @param {unknown} value */
export function validId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** @param {"info" | "warn" | "error"} level @param {string} event @param {Record<string, unknown>} [context] @param {unknown} [error] */
export function writeLog(level, event, context = {}, error) {
  const safe = {};
  for (const [key, value] of Object.entries(context)) {
    if (identifiers.has(key) && validId(value)) safe[key] = value;
    if (labels.has(key) && typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,64}$/.test(value)) safe[key] = value;
    if (numbers.has(key) && typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    if (key === "route" && typeof value === "string" && /^\/[a-zA-Z0-9/_[\]-]{0,100}$/.test(value)) safe[key] = value;
    if (key === "digest" && typeof value === "string" && /^\d{1,32}$/.test(value)) safe[key] = value;
  }
  const name = error instanceof Error && errorNames.has(error.name) ? error.name : "Error";
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event,
    ...safe, ...(error === undefined ? {} : { error: { name } }) });
  console[level](entry);
}

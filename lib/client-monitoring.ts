import { validId } from "./observability.mjs";

export type ErrorSource = "browser.error" | "browser.rejection" | "react.boundary" | "runtime.startup" | "runtime.setup";
let count = 0;
let resetAt = 0;
const reported = new WeakSet<object>();

export function reportClientError(source: ErrorSource, error: unknown, phase?: string): string | undefined {
  if (typeof window === "undefined") return;
  if (error && typeof error === "object") {
    if (reported.has(error)) return;
    reported.add(error);
  }
  if (Date.now() >= resetAt) { resetAt = Date.now() + 60_000; count = 0; }
  if (++count > 20) return;
  const eventId = crypto.randomUUID();
  const pageId = document.querySelector('meta[name="liveide-request-id"]')?.getAttribute("content");
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && /^\d{1,32}$/.test(error.digest) ? error.digest : undefined;
  void fetch("/api/monitoring", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, source, phase, ...(validId(pageId) ? { pageRequestId: pageId } : {}), digest }),
  }).catch(() => undefined);
  return eventId;
}

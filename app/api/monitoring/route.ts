import { z } from "zod";
import { logger } from "@/lib/logger";
import { observeRoute } from "@/lib/observe-route";

const schema = z.object({ eventId: z.string().uuid(), pageRequestId: z.string().uuid().optional(),
  source: z.enum(["browser.error", "browser.rejection", "react.boundary", "runtime.startup", "runtime.setup"]),
  phase: z.enum(["idle", "booting", "mounting", "installing", "starting", "running", "error", "unsupported"]).optional(),
  digest: z.string().regex(/^\d{1,32}$/).optional(),
}).strict();
let resetAt = 0;
let count = 0;

export const POST = observeRoute("/api/monitoring", async (request: Request) => {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  if (Date.now() >= resetAt) { resetAt = Date.now() + 60_000; count = 0; }
  if (++count > 1000) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "60" } });
  if (Number(request.headers.get("content-length")) > 1024) return Response.json({ code: "TOO_LARGE" }, { status: 413 });
  // Bound memory even if Content-Length is missing or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ code: "INVALID_REPORT" }, { status: 400 });
  let raw = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return Response.json({ code: "TOO_LARGE" }, { status: 413 }); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({ code: "INVALID_REPORT" }, { status: 400 });
    logger.error("browser.reported", parsed.data);
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ code: "INVALID_REPORT" }, { status: 400 }); }
});

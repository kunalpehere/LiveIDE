import { requirePlaygroundAccess } from "@/features/playground/lib/authorization";
import { playgroundIdSchema } from "@/features/playground/lib/validation";
import { getCollaborationConfiguration } from "@/lib/runtime-config.mjs";
import { serverDiagnosticsSchema } from "@/lib/collaboration-metrics.mjs";
import { observeRoute } from "@/lib/observe-route";

export const GET = observeRoute("/api/collaboration/diagnostics", async request => {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  const playgroundId = playgroundIdSchema.parse(new URL(request.url).searchParams.get("playgroundId"));
  await requirePlaygroundAccess(playgroundId);
  const { websocketUrl, secret } = getCollaborationConfiguration();
  if (!websocketUrl || !secret) return Response.json({ error: "Collaboration is not configured" }, { status: 503 });
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/diagnostics"; url.search = ""; url.hash = "";
  const started = performance.now();
  const response = await fetch(url, { headers: { "x-collaboration-secret": secret }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(2000) });
  if (!response.ok) return Response.json({ error: "Diagnostics unavailable" }, { status: 503 });
  const server = serverDiagnosticsSchema.parse(await response.json());
  return Response.json({ server, serviceProbeMs: performance.now() - started }, { headers: { "cache-control": "no-store" } });
});

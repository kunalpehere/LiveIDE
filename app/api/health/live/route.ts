import { observeRoute } from "@/lib/observe-route";

export const dynamic = "force-dynamic";
export const GET = observeRoute("/api/health/live", async () => Response.json(
  { service: "liveide", status: "healthy" }, { headers: { "Cache-Control": "no-store" } },
));

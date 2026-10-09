import { applicationHealth } from "@/lib/application-health";
import { observeRoute } from "@/lib/observe-route";

export const dynamic = "force-dynamic";
export const GET = observeRoute("/api/health", async () => {
  const { httpStatus, ...health } = await applicationHealth();
  return Response.json({ service: "liveide", ...health }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
});

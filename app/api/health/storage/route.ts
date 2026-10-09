import { applicationHealth } from "@/lib/application-health";
import { observeRoute } from "@/lib/observe-route";

export const dynamic = "force-dynamic";
export const GET = observeRoute("/api/health/storage", async () => {
  const { httpStatus, ...health } = await applicationHealth(true);
  return Response.json({ service: "liveide-storage", ...health }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
});

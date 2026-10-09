import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), configuration: vi.fn() }));
vi.mock("@/features/playground/lib/authorization", () => ({ requirePlaygroundAccess: mocks.access }));
vi.mock("@/lib/runtime-config.mjs", () => ({ getCollaborationConfiguration: mocks.configuration }));
import { GET } from "@/app/api/collaboration/diagnostics/route";
import { TimingWindow } from "@/lib/collaboration-metrics.mjs";
const request = () => new Request("http://localhost/api/collaboration/diagnostics?playgroundId=project-1");
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  mocks.access.mockResolvedValue({ role: "EDITOR" });
  mocks.configuration.mockReturnValue({ websocketUrl: "ws://127.0.0.1:1234", secret: "private-diagnostics-test-secret" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("disables diagnostics in production before authorization or service calls", async () => {
  vi.stubEnv("NODE_ENV", "production"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await GET(request())).status).toBe(404); expect(mocks.access).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("requires project access before contacting the configured service", async () => {
  mocks.access.mockRejectedValue(new Error("Access rejected")); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await GET(request())).ok).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
it("returns validated anonymous metrics and keeps the service secret server-side", async () => {
  const timing = new TimingWindow(); timing.record(1);
  const server = { service: "liveide-collaboration", activeSockets: 2, processing: timing.snapshot(), authorization: timing.snapshot() };
  const fetch = vi.fn().mockResolvedValue(Response.json(server)); vi.stubGlobal("fetch", fetch);
  const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text(); expect(text).not.toContain("private-diagnostics-test-secret"); expect(JSON.parse(text).server).toEqual(server);
  expect(mocks.access).toHaveBeenCalledWith("project-1");
  expect(fetch.mock.calls[0][0].href).toBe("http://127.0.0.1:1234/diagnostics");
  expect(fetch.mock.calls[0][1].headers["x-collaboration-secret"]).toBe("private-diagnostics-test-secret");
});

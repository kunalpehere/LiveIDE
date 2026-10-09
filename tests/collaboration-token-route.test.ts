import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/features/playground/lib/authorization", () => ({ requirePlaygroundAccess: mocks.authorize }));
import { POST } from "@/app/api/collaboration/token/route";
import { tokenResponseSchema } from "@/lib/collaboration-protocol.mjs";
import { verifyCollaborationToken } from "@/lib/collaboration-token";

const body = { protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx" };
function request(value: unknown) { return new Request("http://localhost/api/collaboration/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
describe("token API protocol negotiation", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "ws://localhost:1234"); vi.stubEnv("COLLABORATION_SECRET", "token-route-test-secret");
    mocks.authorize.mockResolvedValue({ user: { id: "user-1", name: "Owner" }, playground: { collaborationRevision: 4 }, role: "OWNER" });
    vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("returns the actual authorized role and revision in matching signed and response contracts", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    const parsed = tokenResponseSchema.parse(await response.json());
    expect(parsed.data).toMatchObject({ role: "OWNER", revision: 4, protocolVersion: 1 });
    expect(await verifyCollaborationToken(parsed.data.token, "token-route-test-secret")).toMatchObject({ role: "OWNER", revision: 4, room: parsed.data.room });
  });
  it("issues notes tokens at a stable revision independently of source files", async () => {
    const response = await POST(request({ ...body, filePath: ".liveide/notes" }));
    const result = tokenResponseSchema.parse(await response.json());
    expect(result.data).toMatchObject({ filePath: ".liveide/notes", revision: 1 });
    expect(await verifyCollaborationToken(result.data.token, "token-route-test-secret")).toMatchObject({ revision: 1, room: result.data.room });
  });
  it("rejects incompatible clients and caller-supplied roles before authorization", async () => {
    mocks.authorize.mockClear();
    const incompatible = await POST(request({ ...body, protocolVersion: 2 }));
    expect(incompatible.status).toBe(426);
    expect((await incompatible.json()).error.code).toBe("VERSION_MISMATCH");
    const spoofed = await POST(request({ ...body, role: "OWNER" }));
    expect(spoofed.status).toBe(400);
    expect((await spoofed.json()).error.code).toBe("MALFORMED_MESSAGE");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("issues viewers read-scoped tokens from their stored membership", async () => {
    mocks.authorize.mockResolvedValue({ user: { id: "user-1", name: "Viewer" }, playground: { collaborationRevision: 4 }, role: "VIEWER" });
    const response = await POST(request(body)); expect(response.status).toBe(200);
    const result = tokenResponseSchema.parse(await response.json());
    expect(await verifyCollaborationToken(result.data.token, "token-route-test-secret")).toMatchObject({ role: "VIEWER", scope: "collaboration:read" });
  });
});

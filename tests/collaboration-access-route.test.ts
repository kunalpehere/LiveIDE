import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
const mocks = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.user }, playground: { findUnique: mocks.project }, playgroundMember: { findUnique: mocks.member } } }));
import { POST } from "@/app/api/collaboration/access/route";
import { createCollaborationToken } from "@/lib/collaboration-token";
import { collaborationRoom, PROJECT_NOTES_PATH } from "@/lib/collaboration-protocol.mjs";
const secret = "access-route-private-test-secret";
const identity = { playgroundId: "project", filePath: "src/App.tsx", revision: 1, room: collaborationRoom("project", "src/App.tsx"), userId: "user", name: "User", color: "#112233" };
const request = (token: string, serviceSecret = secret) => new Request("http://localhost/api/collaboration/access", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-collaboration-secret": serviceSecret } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("COLLABORATION_SECRET", secret);
  mocks.user.mockResolvedValue({ id: "user" }); mocks.project.mockResolvedValue({ userId: "owner", collaborationRevision: 1 }); mocks.member.mockResolvedValue({ role: "EDITOR" });
});
afterEach(() => vi.unstubAllEnvs());
it("keeps notes authorized across source restores while rejecting forged notes revisions and revoked membership", async () => {
  mocks.project.mockResolvedValue({ userId: "owner", collaborationRevision: 7 });
  const notes = { ...identity, filePath: PROJECT_NOTES_PATH, room: collaborationRoom("project", PROJECT_NOTES_PATH), role: "EDITOR" as const };
  const token = await createCollaborationToken(notes, secret);
  expect((await POST(request(token))).status).toBe(200);
  expect((await POST(request(await createCollaborationToken({ ...notes, revision: 7, room: collaborationRoom("project", PROJECT_NOTES_PATH, 7) }, secret)))).status).toBe(409);
  mocks.member.mockResolvedValue(null); expect((await POST(request(token))).status).toBe(403);
});
it("requires the service secret and a genuine unexpired signed token before querying permissions", async () => {
  const good = await createCollaborationToken({ ...identity, role: "EDITOR" }, secret);
  expect((await POST(request(good, "wrong-secret"))).status).toBe(401);
  const forged = await createCollaborationToken({ ...identity, role: "EDITOR" }, "wrong-signing-key");
  expect((await POST(request(forged))).status).toBe(401);
  const expired = await new SignJWT({ ...identity, role: "EDITOR", protocolVersion: 1, scope: "collaboration:write" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 60).setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(secret));
  expect((await POST(request(expired))).status).toBe(401); expect(mocks.user).not.toHaveBeenCalled();
});
it("validates current editor, viewer and owner permissions rather than trusting a signed role", async () => {
  for (const role of ["EDITOR", "VIEWER", "OWNER"] as const) {
    mocks.project.mockResolvedValue({ userId: role === "OWNER" ? "user" : "owner", collaborationRevision: 1 }); mocks.member.mockResolvedValue({ role });
    const response = await POST(request(await createCollaborationToken({ ...identity, role }, secret)));
    expect(response.status).toBe(200); expect((await response.json()).data.role).toBe(role);
  }
});
it("rejects revoked or changed membership, restored revision, deleted project and deleted user", async () => {
  const token = await createCollaborationToken({ ...identity, role: "EDITOR" }, secret);
  mocks.member.mockResolvedValue(null); expect((await POST(request(token))).status).toBe(403);
  mocks.member.mockResolvedValue({ role: "VIEWER" }); expect((await POST(request(token))).status).toBe(403);
  mocks.project.mockResolvedValue({ userId: "owner", collaborationRevision: 2 }); expect((await POST(request(token))).status).toBe(409);
  mocks.project.mockResolvedValue(null); expect((await POST(request(token))).status).toBe(403);
  mocks.user.mockResolvedValue(null); expect((await POST(request(token))).status).toBe(401);
});

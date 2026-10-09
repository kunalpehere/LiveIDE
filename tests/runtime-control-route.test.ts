import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
const auth = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/actions", () => ({ currentUser: auth.currentUser }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { POST } from "@/app/api/collaboration/runtime-control/route";
const secret = "runtime-control-private-fixture";
const target = { playgroundId: "mock-playground-1", targetUserId: "mock-user-2", targetClientId: 123, targetNonce: crypto.randomUUID(), operation: "stop", revision: 1 };
const request = (data: unknown) => POST(new Request("http://localhost/api/collaboration/runtime-control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
beforeEach(async () => {
  vi.stubEnv("COLLABORATION_SECRET", secret); vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "ws://localhost:1234");
  auth.currentUser.mockResolvedValue({ id: "mock-user-1" });
  await mockDb.playground.update({ where: { id: target.playgroundId }, data: { collaborationRevision: 1 } });
  await mockDb.playgroundMember.upsert({ where: { playgroundId_userId: { playgroundId: target.playgroundId, userId: target.targetUserId } }, create: { playgroundId: target.playgroundId, userId: target.targetUserId, role: "EDITOR" }, update: { role: "EDITOR" } });
});
afterEach(() => vi.unstubAllEnvs());
async function issue() { const response = await request({ ...target, action: "request" }); expect(response.status).toBe(200); return (await response.json()).data; }
const verify = (token: string, extra = {}) => request({ action: "verify", playgroundId: target.playgroundId, token, clientId: target.targetClientId, nonce: target.targetNonce, ...extra });
it("issues and verifies a narrow operation against the host browser and current member roles", async () => {
  const issued = await issue(); auth.currentUser.mockResolvedValue({ id: target.targetUserId });
  const response = await verify(issued.token); expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ requestId: issued.requestId, operation: "stop", requesterId: "mock-user-1" });
});
it("rejects viewer requests, viewer targets, and unauthenticated callers", async () => {
  await mockDb.playgroundMember.upsert({ where: { playgroundId_userId: { playgroundId: target.playgroundId, userId: target.targetUserId } }, create: {}, update: { role: "VIEWER" } });
  expect((await request({ ...target, action: "request" })).status).toBe(403);
  auth.currentUser.mockResolvedValue({ id: target.targetUserId }); expect((await request({ ...target, targetUserId: "mock-user-1", action: "request" })).status).toBe(403);
  auth.currentUser.mockResolvedValue(null); expect((await request({ ...target, action: "request" })).status).toBe(401);
});
it("rejects arbitrary commands and extra environment/arguments fields", async () => {
  for (const data of [{ ...target, operation: "shell" }, { ...target, args: ["cat", ".env"] }, { ...target, env: { SECRET: "secret" } }]) expect((await request({ ...data, action: "request" })).status).toBe(400);
});
it("rejects expired, forged, wrong-host, stale-session, and restored-revision requests", async () => {
  const issued = await issue(); auth.currentUser.mockResolvedValue({ id: target.targetUserId });
  expect((await verify("forged-token")).status).toBe(403);
  expect((await verify(issued.token, { clientId: 999 })).status).toBe(403);
  expect((await verify(issued.token, { nonce: crypto.randomUUID() })).status).toBe(403);
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ ...target, requestId: crypto.randomUUID(), requesterId: "mock-user-1", scope: "runtime:control" }).setProtectedHeader({ alg: "HS256" }).setIssuer("liveide-runtime").setAudience("liveide-runtime-host").setIssuedAt(now - 31).setExpirationTime(now - 1).sign(new TextEncoder().encode(secret));
  expect((await verify(expired)).status).toBe(403);
  await mockDb.playground.update({ where: { id: target.playgroundId }, data: { collaborationRevision: 2 } }); expect((await verify(issued.token)).status).toBe(403);
});
it("rechecks the requester's membership at execution instead of trusting the token", async () => {
  auth.currentUser.mockResolvedValue({ id: target.targetUserId });
  const response = await request({ ...target, action: "request", targetUserId: "mock-user-1" }); const token = (await response.json()).data.token;
  await mockDb.playgroundMember.deleteMany({ where: { playgroundId: target.playgroundId } });
  auth.currentUser.mockResolvedValue({ id: "mock-user-1" }); expect((await verify(token)).status).toBe(403);
});

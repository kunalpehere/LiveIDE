import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({ currentUser: auth.currentUser }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));

import { mockDb } from "@/lib/mock-db";
import { acceptPlaygroundInvitation, createPlaygroundInvitation, inspectPlaygroundInvitation, listPlaygroundInvitations, revokePlaygroundInvitation } from "@/features/playground/actions/invitations";
import { hashInvitationToken, invitationState } from "@/features/playground/lib/invitations";
import { requirePlaygroundAccess } from "@/features/playground/lib/authorization";

const project = "mock-playground-1";
const owner = { id: "mock-user-1", email: "developer@localhost" };
let recipientNumber = 0;
const recipient = () => ({ id: `invitation-recipient-${++recipientNumber}`, email: `recipient${recipientNumber}@example.com` });
beforeEach(() => { auth.currentUser.mockResolvedValue(owner); });
async function create(role: "EDITOR" | "VIEWER" = "VIEWER") {
  const result = await createPlaygroundInvitation(project, { role, expiryHours: 24 });
  if (!result.success) throw new Error(result.message);
  return { ...result.data, token: result.data.path.split("/").at(-1)! };
}

describe("invitation lifecycle using the development database and real authorization", () => {
  it("stores only a hash and does not disclose tokens in listings", async () => {
    const link = await create();
    const record = await mockDb.playgroundInvitation.findUnique({ where: { id: link.id } });
    expect(record?.tokenHash).toBe(hashInvitationToken(link.token));
    expect(JSON.stringify(record)).not.toContain(link.token);
    const listed = await listPlaygroundInvitations(project);
    expect(listed.success).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
    expect(JSON.stringify(listed)).not.toContain(link.token);
  });
  it.each(["VIEWER", "EDITOR"] as const)("grants the selected %s role only after explicit acceptance", async role => {
    const link = await create(role); const user = recipient();
    auth.currentUser.mockResolvedValue(user);
    await expect(requirePlaygroundAccess(project)).rejects.toMatchObject({ name: "AuthorizationError" });
    await expect(inspectPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true, data: { state: "PENDING", role } });
    await expect(requirePlaygroundAccess(project)).rejects.toMatchObject({ name: "AuthorizationError" });
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true, data: { playgroundId: project } });
    await expect(requirePlaygroundAccess(project)).resolves.toMatchObject({ role });
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "INVITATION_USED" });
  });
  it("rejects expired links, including the exact expiry boundary", async () => {
    const link = await create();
    await mockDb.playgroundInvitation.updateMany({ where: { id: link.id }, data: { expiresAt: new Date(0) } });
    auth.currentUser.mockResolvedValue(recipient());
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "INVITATION_EXPIRED" });
    await expect(requirePlaygroundAccess(project)).rejects.toMatchObject({ name: "AuthorizationError" });
    const date = new Date(); expect(invitationState({ usedAt: null, revokedAt: null, expiresAt: date }, date)).toBe("EXPIRED");
  });
  it("rejects revoked links and scopes revocation to the project", async () => {
    const link = await create();
    await expect(revokePlaygroundInvitation("mock-playground-2", link.id)).resolves.toMatchObject({ success: false, code: "INVITATION_UNAVAILABLE" });
    await expect(revokePlaygroundInvitation(project, link.id)).resolves.toMatchObject({ success: true });
    auth.currentUser.mockResolvedValue(recipient());
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "INVITATION_REVOKED" });
    await expect(requirePlaygroundAccess(project)).rejects.toMatchObject({ name: "AuthorizationError" });
  });
  it.each(["EDITOR", "VIEWER"] as const)("prevents %s members from creating, listing or revoking invitations", async role => {
    const link = await create(); const user = recipient();
    await mockDb.playgroundMember.upsert({ where: { playgroundId_userId: { playgroundId: project, userId: user.id } }, create: { playgroundId: project, userId: user.id, role }, update: {} });
    auth.currentUser.mockResolvedValue(user);
    for (const result of await Promise.all([createPlaygroundInvitation(project, { role, expiryHours: 24 }), listPlaygroundInvitations(project), revokePlaygroundInvitation(project, link.id)])) {
      expect(result).toMatchObject({ success: false, code: "FORBIDDEN" });
    }
  });
  it("requires authentication to inspect or accept", async () => {
    const link = await create(); auth.currentUser.mockResolvedValue(null);
    await expect(inspectPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "UNAUTHENTICATED" });
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });
  it("rejects malformed and unknown tokens and invalid expiry/role", async () => {
    await expect(createPlaygroundInvitation(project, { role: "OWNER", expiryHours: 24 })).resolves.toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    await expect(createPlaygroundInvitation(project, { role: "EDITOR", expiryHours: -1 })).resolves.toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    await expect(acceptPlaygroundInvitation("invalid")).resolves.toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    await expect(acceptPlaygroundInvitation("a".repeat(43))).resolves.toMatchObject({ success: false, code: "INVITATION_NOT_FOUND" });
  });
  it("does not consume a link when its owner tries to accept", async () => {
    const link = await create();
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "OWNER_MEMBERSHIP" });
    await expect(inspectPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true, data: { state: "PENDING" } });
  });
  it("preserves an existing member role on acceptance", async () => {
    const link = await create("EDITOR"); const user = recipient();
    await mockDb.playgroundMember.upsert({ where: { playgroundId_userId: { playgroundId: project, userId: user.id } }, create: { playgroundId: project, userId: user.id, role: "VIEWER" }, update: {} });
    auth.currentUser.mockResolvedValue(user);
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true });
    await expect(requirePlaygroundAccess(project)).resolves.toMatchObject({ role: "VIEWER" });
  });
  it("allows only one simultaneous acceptance and one membership", async () => {
    const link = await create(); const first = recipient(), second = recipient();
    auth.currentUser.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const results = await Promise.all([acceptPlaygroundInvitation(link.token), acceptPlaygroundInvitation(link.token)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    const members = await Promise.all([first, second].map(user => mockDb.playgroundMember.findUnique({ where: { playgroundId_userId: { playgroundId: project, userId: user.id } } })));
    expect(members.filter(Boolean)).toHaveLength(1);
  });
  it("rolls back the claim if membership creation fails", async () => {
    const link = await create(); auth.currentUser.mockResolvedValue(recipient());
    const failure = vi.spyOn(mockDb.playgroundMember, "upsert").mockRejectedValueOnce(new Error("fixture database failure"));
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false });
    failure.mockRestore();
    await expect(inspectPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true, data: { state: "PENDING" } });
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true });
  });
  it("cannot revoke an accepted invitation", async () => {
    const link = await create(); const user = recipient(); auth.currentUser.mockResolvedValue(user);
    await acceptPlaygroundInvitation(link.token); auth.currentUser.mockResolvedValue(owner);
    await expect(revokePlaygroundInvitation(project, link.id)).resolves.toMatchObject({ success: false, code: "INVITATION_UNAVAILABLE" });
    auth.currentUser.mockResolvedValue(user); await expect(requirePlaygroundAccess(project)).resolves.toMatchObject({ role: "VIEWER" });
  });
  it("retries a database transaction conflict without leaving a consumed claim", async () => {
    const link = await create(); auth.currentUser.mockResolvedValue(recipient());
    const failure = vi.spyOn(mockDb.playgroundMember, "upsert").mockRejectedValueOnce({ code: "P2034" });
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true });
    expect(failure).toHaveBeenCalledTimes(2); failure.mockRestore();
  });
  it("rejects a stale invitation lookup when its link has just been revoked", async () => {
    const link = await create(); auth.currentUser.mockResolvedValue(recipient());
    const stale = await mockDb.playgroundInvitation.findUnique({ where: { id: link.id }, include: { playground: true } });
    await mockDb.playgroundInvitation.updateMany({ where: { id: link.id }, data: { revokedAt: new Date() } });
    const racing = vi.spyOn(mockDb.playgroundInvitation, "findUnique").mockResolvedValueOnce(stale);
    await expect(acceptPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: false, code: "INVITATION_UNAVAILABLE" });
    racing.mockRestore();
    await expect(requirePlaygroundAccess(project)).rejects.toMatchObject({ name: "AuthorizationError" });
    await expect(inspectPlaygroundInvitation(link.token)).resolves.toMatchObject({ success: true, data: { state: "REVOKED" } });
  });
});

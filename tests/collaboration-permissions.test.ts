import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  playgroundFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberFindFirst: vi.fn(),
  memberUpsert: vi.fn(),
  memberUpdate: vi.fn(),
  memberDeleteMany: vi.fn(),
  userFindUnique: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/actions", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db", () => ({ db: {
  playground: { findUnique: mocks.playgroundFindUnique },
  playgroundMember: {
    findUnique: mocks.memberFindUnique,
    findMany: mocks.memberFindMany,
    findFirst: mocks.memberFindFirst,
    upsert: mocks.memberUpsert,
    update: mocks.memberUpdate,
    deleteMany: mocks.memberDeleteMany,
  },
  user: { findUnique: mocks.userFindUnique },
} }));

import { requirePlaygroundAccess, requirePlaygroundEditor, requirePlaygroundOwner } from "@/features/playground/lib/authorization";
import { invitePlaygroundCollaborator, removePlaygroundCollaborator } from "@/features/playground/actions/collaboration";

const playground = { id: "project-one", userId: "owner-one", title: "Shared" };

beforeEach(() => {
  mocks.currentUser.mockResolvedValue({ id: "member-one", email: "member@example.com" });
  mocks.playgroundFindUnique.mockResolvedValue(playground);
  mocks.memberFindUnique.mockResolvedValue({ id: "membership-one", role: "VIEWER", userId: "member-one", playgroundId: playground.id });
});

describe("playground collaboration permissions", () => {
  it("allows viewers to read but not edit or manage sharing", async () => {
    await expect(requirePlaygroundAccess(playground.id)).resolves.toMatchObject({ role: "VIEWER" });
    await expect(requirePlaygroundEditor(playground.id)).rejects.toMatchObject({ name: "AuthorizationError" });
    await expect(requirePlaygroundOwner(playground.id)).rejects.toMatchObject({ name: "AuthorizationError" });
  });

  it("allows editors to pass the edit guard but not the owner guard", async () => {
    mocks.memberFindUnique.mockResolvedValue({ role: "EDITOR" });
    await expect(requirePlaygroundEditor(playground.id)).resolves.toMatchObject({ role: "EDITOR" });
    await expect(requirePlaygroundOwner(playground.id)).rejects.toMatchObject({ name: "AuthorizationError" });
  });

  it("lets only the owner invite an existing user", async () => {
    const target = { id: "target-user", email: "target@example.com", name: "Target" };
    mocks.currentUser.mockResolvedValue({ id: playground.userId, email: "owner@example.com" });
    mocks.userFindUnique.mockResolvedValue(target);
    mocks.memberUpsert.mockResolvedValue({ id: "new-membership", role: "EDITOR", user: target });

    await expect(invitePlaygroundCollaborator(playground.id, { email: target.email, role: "EDITOR" }))
      .resolves.toMatchObject({ success: true, data: { role: "EDITOR" } });
    expect(mocks.memberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { playgroundId_userId: { playgroundId: playground.id, userId: target.id } },
    }));
  });

  it("scopes collaborator removal to the selected playground", async () => {
    mocks.currentUser.mockResolvedValue({ id: playground.userId });
    mocks.memberDeleteMany.mockResolvedValue({ count: 1 });
    await expect(removePlaygroundCollaborator(playground.id, "membership-one"))
      .resolves.toEqual({ success: true, data: { id: "membership-one" } });
    expect(mocks.memberDeleteMany).toHaveBeenCalledWith({ where: { id: "membership-one", playgroundId: playground.id } });
  });
});

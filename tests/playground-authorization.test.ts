import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  revalidatePath: vi.fn(),
  playgroundFindUnique: vi.fn(),
  playgroundFindMany: vi.fn(),
  playgroundCreate: vi.fn(),
  playgroundUpdate: vi.fn(),
  playgroundUpdateMany: vi.fn(),
  playgroundDelete: vi.fn(),
  templateFileUpsert: vi.fn(),
  templateFileUpdateMany: vi.fn(),
  templateFileFindUnique: vi.fn(),
  templateFileFindUniqueOrThrow: vi.fn(),
  starMarkUpsert: vi.fn(),
  starMarkDeleteMany: vi.fn(),
  playgroundMemberFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/actions", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (callback: any) => callback({ playground: { updateMany: mocks.playgroundUpdateMany, delete: mocks.playgroundDelete } }),
    playground: {
      findUnique: mocks.playgroundFindUnique,
      findMany: mocks.playgroundFindMany,
      create: mocks.playgroundCreate,
      update: mocks.playgroundUpdate,
      updateMany: mocks.playgroundUpdateMany,
      delete: mocks.playgroundDelete,
    },
    templateFile: {
      upsert: mocks.templateFileUpsert,
      updateMany: mocks.templateFileUpdateMany,
      findUnique: mocks.templateFileFindUnique,
      findUniqueOrThrow: mocks.templateFileFindUniqueOrThrow,
    },
    starMark: {
      upsert: mocks.starMarkUpsert,
      deleteMany: mocks.starMarkDeleteMany,
    },
    playgroundMember: {
      findUnique: mocks.playgroundMemberFindUnique,
    },
  },
}));

import {
  SaveUpdatedCode,
  createPlayground,
  deleteProjectById,
  duplicateProjectById,
  editProjectById,
  getPlaygroundById,
  toggleStarMarked,
} from "@/features/playground/actions";
import { GET as getTemplate } from "@/app/api/template/[id]/route";

const userA = { id: "user-a", email: "a@example.com", role: "USER" };
const userBPlayground = {
  id: "playground-b",
  title: "User B project",
  description: null,
  template: "REACT",
  userId: "user-b",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const templateData = {
  folderName: "Root",
  items: [{ filename: "index", fileExtension: "ts", content: "export {};" }],
};

beforeEach(() => {
  mocks.playgroundUpdateMany.mockResolvedValue({ count: 1 });
  mocks.currentUser.mockResolvedValue(userA);
  mocks.playgroundFindUnique.mockResolvedValue(userBPlayground);
  mocks.playgroundMemberFindUnique.mockResolvedValue(null);
});

describe("playground ownership enforcement", () => {
  it("rejects oversized saved files before any template mutation", async () => {
    mocks.playgroundFindUnique.mockResolvedValue({ ...userBPlayground, userId: userA.id });
    const oversized = { folderName: "Root", items: [{ filename: "large", fileExtension: "txt", content: "x".repeat(256 * 1024 + 1) }] };
    expect(await SaveUpdatedCode(userBPlayground.id, oversized, 1)).toMatchObject({ success: false, code: "FILE_SIZE_LIMIT", message: expect.stringContaining("Reduce") });
    expect(mocks.templateFileUpdateMany).not.toHaveBeenCalled();
    expect(mocks.templateFileUpsert).not.toHaveBeenCalled();
  });
  it("prevents User A from reading User B's playground", async () => {
    await expect(getPlaygroundById(userBPlayground.id)).rejects.toMatchObject({ name: "AuthorizationError" });
  });

  it.each([
    ["save", () => SaveUpdatedCode(userBPlayground.id, templateData)],
    ["edit", () => editProjectById(userBPlayground.id, { title: "Changed", description: "" })],
    ["delete", () => deleteProjectById(userBPlayground.id)],
    ["duplicate", () => duplicateProjectById(userBPlayground.id)],
    ["favorite", () => toggleStarMarked(userBPlayground.id, true)],
  ])("prevents User A from attempting to %s User B's playground", async (_operation, execute) => {
    await expect(execute()).resolves.toMatchObject({ success: false, code: "FORBIDDEN" });
  });

  it("does not execute any mutation after access is denied", async () => {
    const attempts = [
      () => SaveUpdatedCode(userBPlayground.id, templateData),
      () => editProjectById(userBPlayground.id, { title: "Changed", description: "" }),
      () => deleteProjectById(userBPlayground.id),
      () => duplicateProjectById(userBPlayground.id),
      () => toggleStarMarked(userBPlayground.id, true),
    ];

    await Promise.all(attempts.map(attempt => expect(attempt()).resolves.toMatchObject({ success: false })));

    expect(mocks.templateFileUpsert).not.toHaveBeenCalled();
    expect(mocks.playgroundUpdate).not.toHaveBeenCalled();
    expect(mocks.playgroundDelete).not.toHaveBeenCalled();
    expect(mocks.playgroundCreate).not.toHaveBeenCalled();
    expect(mocks.starMarkUpsert).not.toHaveBeenCalled();
    expect(mocks.starMarkDeleteMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 403 from the template API for another user's playground", async () => {
    const response = await getTemplate(
      new Request("http://localhost/api/template/playground-b") as never,
      { params: Promise.resolve({ id: userBPlayground.id }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" },
    });
  });

  it("rejects project creation when there is no authenticated user", async () => {
    mocks.currentUser.mockResolvedValue(null);

    await expect(createPlayground({ title: "Project", template: "REACT" }))
      .resolves.toMatchObject({ success: false, code: "UNAUTHENTICATED" });
    expect(mocks.playgroundCreate).not.toHaveBeenCalled();
  });

  it("stores native JSON and increments the expected document version", async () => {
    mocks.playgroundFindUnique.mockResolvedValue({ ...userBPlayground, userId: userA.id });
    mocks.templateFileUpdateMany.mockResolvedValue({ count: 1 });
    mocks.templateFileFindUniqueOrThrow.mockResolvedValue({
      id: "document-a",
      playgroundId: userBPlayground.id,
      content: templateData,
      version: 2,
    });

    const result = await SaveUpdatedCode(userBPlayground.id, templateData, 1);

    expect(mocks.templateFileUpdateMany).toHaveBeenCalledWith({
      where: { playgroundId: userBPlayground.id, version: 1 },
      data: { content: templateData, version: { increment: 1 } },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe(2);
  });

  it("rejects a stale save instead of overwriting a newer document", async () => {
    mocks.playgroundFindUnique.mockResolvedValue({ ...userBPlayground, userId: userA.id });
    mocks.templateFileUpdateMany.mockResolvedValue({ count: 0 });
    mocks.templateFileFindUnique.mockResolvedValue({
      id: "document-a",
      playgroundId: userBPlayground.id,
      content: templateData,
      version: 3,
    });

    await expect(SaveUpdatedCode(userBPlayground.id, templateData, 1))
      .resolves.toMatchObject({ success: false, code: "SAVE_CONFLICT" });
    expect(mocks.templateFileUpsert).not.toHaveBeenCalled();
  });

  it("creates a validated project for the current user", async () => {
    const created = { ...userBPlayground, id: "created-project", userId: userA.id };
    mocks.playgroundCreate.mockResolvedValue(created);
    const result = await createPlayground({ title: "Created project", template: "REACT" });
    expect(result).toEqual({ success: true, data: created });
    expect(mocks.playgroundCreate).toHaveBeenCalledWith({
      data: { title: "Created project", description: undefined, template: "REACT", userId: userA.id },
    });
  });

  it("edits, deletes, and favorites an owned project", async () => {
    const owned = { ...userBPlayground, userId: userA.id };
    mocks.playgroundFindUnique.mockResolvedValue(owned);
    mocks.playgroundUpdate.mockResolvedValue({ ...owned, title: "Updated" });
    mocks.playgroundDelete.mockResolvedValue(owned);
    mocks.starMarkUpsert.mockResolvedValue({ isMarked: true });

    await expect(editProjectById(owned.id, { title: "Updated", description: "" }))
      .resolves.toMatchObject({ success: true });
    await expect(deleteProjectById(owned.id)).resolves.toEqual({ success: true, data: { id: owned.id } });
    await expect(toggleStarMarked(owned.id, true)).resolves.toEqual({ success: true, data: { isMarked: true } });
  });

  it("duplicates an owned project including its saved content", async () => {
    const owned = { ...userBPlayground, userId: userA.id };
    mocks.playgroundFindUnique
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce({ ...owned, templateFiles: [{ content: templateData }] });
    const duplicate = { ...owned, id: "duplicate", title: `${owned.title} (Copy)` };
    mocks.playgroundCreate.mockResolvedValue(duplicate);

    await expect(duplicateProjectById(owned.id)).resolves.toEqual({ success: true, data: duplicate });
    expect(mocks.playgroundCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: `${owned.title} (Copy)`, userId: userA.id }),
    }));
  });
});

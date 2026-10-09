import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), playgroundFindUnique: vi.fn(), playgroundUpdate: vi.fn(), memberFindUnique: vi.fn(),
  templateFindUnique: vi.fn(), templateUpsert: vi.fn(), snapshotCreate: vi.fn(), snapshotFindFirst: vi.fn(),
  snapshotDeleteMany: vi.fn(), snapshotCount: vi.fn(), eventCreate: vi.fn(), collaborationDeleteMany: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/actions", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/features/playground/lib/starter-template-service", () => ({ getStarterTemplate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: async (callback: any) => callback({ playground: { update: mocks.playgroundUpdate, findUniqueOrThrow: mocks.playgroundFindUnique }, templateFile: { findUnique: mocks.templateFindUnique, upsert: mocks.templateUpsert }, playgroundSnapshot: { create: mocks.snapshotCreate, count: mocks.snapshotCount, findFirst: mocks.snapshotFindFirst, deleteMany: mocks.snapshotDeleteMany }, collaborationDocument: { deleteMany: mocks.collaborationDeleteMany }, playgroundHistoryEvent: { create: mocks.eventCreate } }),
  playground: { findUnique: mocks.playgroundFindUnique, update: mocks.playgroundUpdate },
  playgroundMember: { findUnique: mocks.memberFindUnique },
  templateFile: { findUnique: mocks.templateFindUnique, upsert: mocks.templateUpsert },
  playgroundSnapshot: { create: mocks.snapshotCreate, findFirst: mocks.snapshotFindFirst, deleteMany: mocks.snapshotDeleteMany },
  playgroundHistoryEvent: { create: mocks.eventCreate },
  collaborationDocument: { deleteMany: mocks.collaborationDeleteMany },
} }));

import { createPlaygroundSnapshot, deletePlaygroundSnapshot, restorePlaygroundSnapshot } from "@/features/playground/actions/history";

const playground = { id: "project-1", userId: "owner-1", template: "REACT", collaborationRevision: 1, updatedAt: new Date() };
const content = { folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: "v1" }] };

describe("playground version history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshotCount.mockResolvedValue(0);
    mocks.currentUser.mockResolvedValue({ id: "editor-1", name: "Editor One", email: "editor@example.com" });
    mocks.playgroundFindUnique.mockResolvedValue(playground);
    mocks.memberFindUnique.mockResolvedValue({ role: "EDITOR" });
    mocks.templateFindUnique.mockResolvedValue({ content, version: 4 });
    mocks.templateUpsert.mockResolvedValue({ content, version: 5 });
    mocks.playgroundUpdate.mockResolvedValue({ ...playground, collaborationRevision: 2 });
    mocks.snapshotCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: "snapshot-new", createdAt: new Date() }));
    mocks.eventCreate.mockResolvedValue({ id: "event-1" });
  });

  it("allows editors to create a named snapshot of saved content", async () => {
    const result = await createPlaygroundSnapshot(playground.id, "Stable release");
    expect(result).toMatchObject({ success: true, data: { name: "Stable release", templateVersion: 4 } });
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content, kind: "MANUAL" }) }));
  });

  it("prevents viewers from creating snapshots", async () => {
    mocks.memberFindUnique.mockResolvedValue({ role: "VIEWER" });
    await expect(createPlaygroundSnapshot(playground.id, "Blocked")).resolves.toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("creates a restore point and advances the collaboration revision", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "snapshot-old", name: "Earlier", content: { ...content, restored: true } });
    const result = await restorePlaygroundSnapshot(playground.id, "snapshot-old");
    expect(result).toMatchObject({ success: true, data: { snapshotId: "snapshot-old", name: "Earlier", restorePointId: "snapshot-new", version: 5 } });
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "RESTORE_POINT" }) }));
    expect(mocks.playgroundUpdate).toHaveBeenCalledWith({ where: { id: playground.id }, data: { collaborationRevision: { increment: 1 } } });
    expect(mocks.collaborationDeleteMany).toHaveBeenCalledWith({ where: { playgroundId: playground.id, filePath: { not: ".liveide/notes" } } });
  });

  it("restricts snapshot deletion to the project owner", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "snapshot-old", name: "Earlier" });
    await expect(deletePlaygroundSnapshot(playground.id, "snapshot-old")).resolves.toMatchObject({ success: false, code: "FORBIDDEN" });
    mocks.currentUser.mockResolvedValue({ id: playground.userId, name: "Owner" });
    mocks.snapshotDeleteMany.mockResolvedValue({ count: 1 });
    await expect(deletePlaygroundSnapshot(playground.id, "snapshot-old")).resolves.toMatchObject({ success: true });
  });

  it("accepts the fiftieth snapshot and rejects the fifty-first without writing content", async () => {
    mocks.snapshotCount.mockResolvedValue(49);
    expect(await createPlaygroundSnapshot(playground.id, "Last slot")).toMatchObject({ success: true });
    mocks.snapshotCreate.mockClear();
    mocks.eventCreate.mockClear();
    mocks.snapshotCount.mockResolvedValue(50);
    expect(await createPlaygroundSnapshot(playground.id, "Over limit")).toMatchObject({ success: false, code: "SNAPSHOT_COUNT_LIMIT", message: expect.stringContaining("delete") });
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("rejects restore when there is no room for its safety snapshot", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "old", name: "Old", content });
    mocks.snapshotCount.mockResolvedValue(50);
    expect(await restorePlaygroundSnapshot(playground.id, "old")).toMatchObject({ success: false, code: "SNAPSHOT_COUNT_LIMIT" });
    expect(mocks.templateUpsert).not.toHaveBeenCalled();
    expect(mocks.collaborationDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects oversized legacy snapshots before starting a restore", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "old", name: "Old", content: { folderName: "Root", items: [{ filename: "big", fileExtension: "txt", content: "x".repeat(256 * 1024 + 1) }] } });
    expect(await restorePlaygroundSnapshot(playground.id, "old")).toMatchObject({ success: false, code: "FILE_SIZE_LIMIT" });
    expect(mocks.playgroundUpdate).not.toHaveBeenCalled();
  });

  it("rejects stale and invalid expected versions before making changes", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "old", name: "Old", content });
    expect(await restorePlaygroundSnapshot(playground.id, "old", 3)).toMatchObject({ success: false, code: "SAVE_CONFLICT" });
    expect(await restorePlaygroundSnapshot(playground.id, "old", -1)).toMatchObject({ success: false });
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
    expect(mocks.templateUpsert).not.toHaveBeenCalled();
    expect(mocks.playgroundUpdate).not.toHaveBeenCalled();
  });

  it("turns transaction contention into a refreshable history conflict", async () => {
    mocks.playgroundUpdate.mockRejectedValueOnce({ code: "P2034" });
    expect(await createPlaygroundSnapshot(playground.id, "Concurrent")).toMatchObject({ success: false, code: "HISTORY_CONFLICT" });
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("does not record a deletion if the scoped delete loses its target", async () => {
    mocks.currentUser.mockResolvedValue({ id: playground.userId });
    mocks.snapshotFindFirst.mockResolvedValue({ id: "old", name: "Old", content });
    mocks.snapshotDeleteMany.mockResolvedValue({ count: 0 });
    expect(await deletePlaygroundSnapshot(playground.id, "old")).toMatchObject({ success: false, code: "HISTORY_CONFLICT" });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
});

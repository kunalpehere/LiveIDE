import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), playgroundFindUnique: vi.fn(), playgroundUpdate: vi.fn(), memberFindUnique: vi.fn(),
  templateFindUnique: vi.fn(), templateUpsert: vi.fn(), snapshotCreate: vi.fn(), snapshotFindFirst: vi.fn(),
  snapshotDeleteMany: vi.fn(), eventCreate: vi.fn(), collaborationDeleteMany: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/actions", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/features/playground/lib/starter-template-service", () => ({ getStarterTemplate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  playground: { findUnique: mocks.playgroundFindUnique, update: mocks.playgroundUpdate },
  playgroundMember: { findUnique: mocks.memberFindUnique },
  templateFile: { findUnique: mocks.templateFindUnique, upsert: mocks.templateUpsert },
  playgroundSnapshot: { create: mocks.snapshotCreate, findFirst: mocks.snapshotFindFirst, deleteMany: mocks.snapshotDeleteMany },
  playgroundHistoryEvent: { create: mocks.eventCreate },
  collaborationDocument: { deleteMany: mocks.collaborationDeleteMany },
} }));

import { createPlaygroundSnapshot, deletePlaygroundSnapshot, restorePlaygroundSnapshot } from "@/features/playground/actions/history";

const playground = { id: "project-1", userId: "owner-1", template: "REACT", collaborationRevision: 1 };
const content = { folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: "v1" }] };

describe("playground version history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: "editor-1", name: "Editor One", email: "editor@example.com" });
    mocks.playgroundFindUnique.mockResolvedValue(playground);
    mocks.memberFindUnique.mockResolvedValue({ role: "EDITOR" });
    mocks.templateFindUnique.mockResolvedValue({ content, version: 4 });
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
    expect(result).toEqual({ success: true, data: { snapshotId: "snapshot-old", name: "Earlier" } });
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "RESTORE_POINT" }) }));
    expect(mocks.playgroundUpdate).toHaveBeenCalledWith({ where: { id: playground.id }, data: { collaborationRevision: { increment: 1 } } });
    expect(mocks.collaborationDeleteMany).toHaveBeenCalledWith({ where: { playgroundId: playground.id } });
  });

  it("restricts snapshot deletion to the project owner", async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ id: "snapshot-old", name: "Earlier" });
    await expect(deletePlaygroundSnapshot(playground.id, "snapshot-old")).resolves.toMatchObject({ success: false, code: "FORBIDDEN" });
    mocks.currentUser.mockResolvedValue({ id: playground.userId, name: "Owner" });
    mocks.snapshotDeleteMany.mockResolvedValue({ count: 1 });
    await expect(deletePlaygroundSnapshot(playground.id, "snapshot-old")).resolves.toMatchObject({ success: true });
  });
});


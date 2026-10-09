import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const auth = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({ currentUser: auth.user }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { SaveUpdatedCode } from "@/features/playground/actions";
import { createPlaygroundSnapshot, restorePlaygroundSnapshot, deletePlaygroundSnapshot, listPlaygroundHistory } from "@/features/playground/actions/history";
const tree = (text: string) => ({ folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: text }] });
async function project() {
  return mockDb.playground.create({ data: { title: "History verification", template: "REACT", userId: "mock-user-1" } });
}
function data<T>(result: { success: true; data: T } | { success: false }) {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("Action failed");
  return result.data;
}
beforeEach(() => auth.user.mockResolvedValue({ id: "mock-user-1", name: "Owner" }));
afterEach(() => vi.restoreAllMocks());

describe("immutable history through application operations", () => {
  it("keeps a captured native tree/version unchanged after saves, repeated restores, and mutated return values", async () => {
    const p = await project();
    data(await SaveUpdatedCode(p.id, tree("original")));
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Original"));
    const captured = await mockDb.playgroundSnapshot.findFirst({ where: { id: snapshot.id, playgroundId: p.id } });
    captured.content.items[0].content = "mutated reader";
    data(await SaveUpdatedCode(p.id, tree("later"), 1));
    const restored = data(await restorePlaygroundSnapshot(p.id, snapshot.id, 2));
    expect(restored.version).toBe(3);
    data(await restorePlaygroundSnapshot(p.id, snapshot.id, 3));
    const saved = await mockDb.templateFile.findUnique({ where: { playgroundId: p.id } });
    expect(saved).toMatchObject({ content: tree("original"), version: 4 });
    expect(await mockDb.playgroundSnapshot.findFirst({ where: { id: snapshot.id, playgroundId: p.id } })).toMatchObject({ content: tree("original"), templateVersion: 1 });
    const history = data(await listPlaygroundHistory(p.id));
    expect(history.retention).toMatchObject({ count: 3, remaining: 47, automaticDeletion: false });
    const event = history.events.find(event => event.resultingVersion === 3)!;
    expect(event).toMatchObject({ actorName: "Owner", snapshotId: snapshot.id, snapshotName: "Original", snapshotVersion: 1, previousVersion: 2, resultingVersion: 3, collaborationRevision: 2, restorePointId: restored.restorePointId });
    expect(await mockDb.playgroundSnapshot.findFirst({ where: { id: restored.restorePointId, playgroundId: p.id } })).toMatchObject({ content: tree("later"), templateVersion: 2, kind: "RESTORE_POINT" });
    expect(history.snapshots.every(item => !("content" in item))).toBe(true);
    data(await deletePlaygroundSnapshot(p.id, snapshot.id));
    expect(data(await listPlaygroundHistory(p.id)).events).toEqual(expect.arrayContaining([expect.objectContaining({ snapshotId: snapshot.id, type: "SNAPSHOT_RESTORED", snapshotName: "Original" })]));
  });

  it("retains legacy string content and creates a new version rather than rewinding the version counter", async () => {
    const p = await project(), legacy = JSON.stringify(tree("legacy"));
    await mockDb.templateFile.create({ data: { playgroundId: p.id, content: legacy, version: 8 } });
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Legacy"));
    data(await SaveUpdatedCode(p.id, tree("new"), 8));
    expect(data(await restorePlaygroundSnapshot(p.id, snapshot.id, 9)).version).toBe(10);
    expect(await mockDb.templateFile.findUnique({ where: { playgroundId: p.id } })).toMatchObject({ content: legacy, version: 10 });
    expect(await mockDb.playgroundSnapshot.findFirst({ where: { id: snapshot.id, playgroundId: p.id } })).toMatchObject({ content: legacy, templateVersion: 8 });
  });

  it("rolls back the safety copy, saved state, revision, and source checkpoints if the audit write fails", async () => {
    const p = await project();
    data(await SaveUpdatedCode(p.id, tree("initial")));
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Initial"));
    data(await SaveUpdatedCode(p.id, tree("later"), 1));
    await mockDb.collaborationDocument.upsert({ where: { room: p.id }, update: {}, create: { room: p.id, playgroundId: p.id, filePath: "App.tsx", state: "AAA=" } });
    vi.spyOn(mockDb.playgroundHistoryEvent, "create").mockRejectedValueOnce(new Error("Audit write unavailable"));
    expect(await restorePlaygroundSnapshot(p.id, snapshot.id, 2)).toMatchObject({ success: false });
    expect(await mockDb.templateFile.findUnique({ where: { playgroundId: p.id } })).toMatchObject({ content: tree("later"), version: 2 });
    expect(await mockDb.playground.findUnique({ where: { id: p.id } })).toMatchObject({ collaborationRevision: 1 });
    expect(await mockDb.playgroundSnapshot.count({ where: { playgroundId: p.id } })).toBe(1);
    expect(await mockDb.collaborationDocument.findUnique({ where: { room: p.id } })).not.toBeNull();
  });

  it("rolls back a deletion if its audit fails and leaves audit references intact after successful deletion", async () => {
    const p = await project();
    data(await SaveUpdatedCode(p.id, tree("saved")));
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Keep"));
    vi.spyOn(mockDb.playgroundHistoryEvent, "create").mockRejectedValueOnce(new Error("Audit unavailable"));
    expect(await deletePlaygroundSnapshot(p.id, snapshot.id)).toMatchObject({ success: false });
    expect(await mockDb.playgroundSnapshot.count({ where: { playgroundId: p.id } })).toBe(1);
    data(await deletePlaygroundSnapshot(p.id, snapshot.id));
    const history = data(await listPlaygroundHistory(p.id));
    expect(history.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "SNAPSHOT_CREATED", snapshotName: "Keep" }), expect.objectContaining({ type: "SNAPSHOT_DELETED", snapshotName: "Keep", snapshotVersion: 1 })]));
  });

  it("admits only one concurrent snapshot into the last retention slot and reopens capacity after owner deletion", async () => {
    const p = await project();
    data(await SaveUpdatedCode(p.id, tree("saved")));
    for (let i = 0; i < 49; i++) await mockDb.playgroundSnapshot.create({ data: { playgroundId: p.id, name: `Retained ${i}`, kind: "MANUAL", content: tree("saved"), templateVersion: 1, createdById: "mock-user-1", createdByName: "Owner" } });
    const results = await Promise.all([createPlaygroundSnapshot(p.id, "A"), createPlaygroundSnapshot(p.id, "B")]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({ success: false, code: "SNAPSHOT_COUNT_LIMIT" }));
    const full = data(await listPlaygroundHistory(p.id));
    expect(full.retention).toMatchObject({ count: 50, remaining: 0 });
    expect(await restorePlaygroundSnapshot(p.id, full.snapshots[0].id, 1)).toMatchObject({ success: false, code: "SNAPSHOT_COUNT_LIMIT" });
    data(await deletePlaygroundSnapshot(p.id, full.snapshots[0].id));
    data(await createPlaygroundSnapshot(p.id, "Reopened"));
    expect(await mockDb.playgroundSnapshot.count({ where: { playgroundId: p.id } })).toBe(50);
  });

  it("accepts one concurrent restore from the displayed version and rejects the stale second one", async () => {
    const p = await project();
    data(await SaveUpdatedCode(p.id, tree("saved")));
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Saved"));
    const results = await Promise.all([restorePlaygroundSnapshot(p.id, snapshot.id, 1), restorePlaygroundSnapshot(p.id, snapshot.id, 1)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results).toContainEqual(expect.objectContaining({ success: false, code: "SAVE_CONFLICT" }));
    expect(await mockDb.playgroundSnapshot.count({ where: { playgroundId: p.id } })).toBe(2);
  });

  it("scopes snapshot lookup to the project and preserves notes while clearing source checkpoints", async () => {
    const p = await project(), other = await project();
    data(await SaveUpdatedCode(p.id, tree("saved")));
    const snapshot = data(await createPlaygroundSnapshot(p.id, "Saved"));
    expect(await restorePlaygroundSnapshot(other.id, snapshot.id)).toMatchObject({ success: false, code: "SNAPSHOT_NOT_FOUND" });
    for (const filePath of [".liveide/notes", "App.tsx"]) await mockDb.collaborationDocument.upsert({ where: { room: p.id + filePath }, update: {}, create: { room: p.id + filePath, playgroundId: p.id, filePath, state: "AAA=" } });
    data(await restorePlaygroundSnapshot(p.id, snapshot.id, 1));
    const documents = await mockDb.collaborationDocument.findMany({ where: { playgroundId: p.id } });
    expect(documents.map(document => document.filePath)).toEqual([".liveide/notes"]);
  });
});

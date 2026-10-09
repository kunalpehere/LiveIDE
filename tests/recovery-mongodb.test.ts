import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { requireDrillUri, digest } from "@/scripts/recovery-policy.mjs";
import { collaborationRoom } from "@/lib/collaboration-protocol.mjs";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const auth = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({ currentUser: auth.currentUser }));
vi.mock("@/lib/db", async () => {
  const uri = process.env.RECOVERY_DRILL_URI;
  if (!uri) return { db: undefined };
  const { requireDrillUri } = await import("@/scripts/recovery-policy.mjs");
  if (requireDrillUri(uri, "restored").nonce !== process.env.RECOVERY_DRILL_RUN) throw new Error("Recovery fixture nonce mismatch");
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: uri }) };
});
import { db } from "@/lib/db";
import { getPlaygroundById, SaveUpdatedCode } from "@/features/playground/actions";
import { createPlaygroundSnapshot, restorePlaygroundSnapshot, listPlaygroundHistory } from "@/features/playground/actions/history";
import { GET as hydrate } from "@/app/api/collaboration/snapshot/route";

const uri = process.env.RECOVERY_DRILL_URI;
if (uri) requireDrillUri(uri, "restored");
const tree = (text: string) => ({ folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: text }, { folderName: "empty", items: [] }] });
beforeEach(() => auth.currentUser.mockResolvedValue({ id: "recovery-owner", name: "Owner" }));
afterAll(async () => { if (uri) await db.$disconnect(); });

// The ordinary unit suite visibly skips these. verify:recovery must run all five on real MongoDB.
describe.skipIf(!uri)("application verification after real BSON recovery", () => {
  it("reads recovered native and legacy trees with the original versions and owner access", async () => {
    const native = await getPlaygroundById("recovery-native"), legacy = await getPlaygroundById("recovery-legacy");
    expect(native).toMatchObject({ accessRole: "OWNER", templateFiles: [{ version: 3, content: tree("saved v3 😀\n") }] });
    expect(legacy).toMatchObject({ templateFiles: [{ version: 8, content: JSON.stringify(tree("legacy saved v8")) }] });
    expect(await db.playgroundInvitation.count()).toBe(1);
    expect(await db.gitHubCommitOperation.findUnique({ where: { id: "recovery-operation" } })).toMatchObject({ status: "PREPARED", connectionVersion: "fixture-version" });
  });

  it("recovers editor/viewer memberships and continues to reject viewer writes and unauthorized reads", async () => {
    auth.currentUser.mockResolvedValue({ id: "recovery-editor" });
    expect(await getPlaygroundById("recovery-native")).toMatchObject({ accessRole: "EDITOR" });
    auth.currentUser.mockResolvedValue({ id: "recovery-viewer" });
    expect(await getPlaygroundById("recovery-native")).toMatchObject({ accessRole: "VIEWER" });
    expect(await SaveUpdatedCode("recovery-native", tree("blocked"), 3)).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await createPlaygroundSnapshot("recovery-native", "Blocked")).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await restorePlaygroundSnapshot("recovery-native", "recovery-snapshot-original", 3)).toMatchObject({ success: false, code: "FORBIDDEN" });
    auth.currentUser.mockResolvedValue({ id: "unrelated-user" });
    await expect(getPlaygroundById("recovery-native")).rejects.toMatchObject({ name: "AuthorizationError" });
  });

  it("hydrates the actual recovered source and notes checkpoints through the application route", async () => {
    vi.stubEnv("COLLABORATION_SECRET", "recovery-fixture-collaboration-secret");
    vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "");
    try {
      for (const [filePath, revision, expected] of [["App.tsx", 3, "saved v3 😀\n + checkpoint edits"], [".liveide/notes", 1, "# Recovered team notes"]] as const) {
        const query = new URLSearchParams({ protocolVersion: "1", playgroundId: "recovery-native", filePath, revision: String(revision), room: collaborationRoom("recovery-native", filePath, revision) });
        const response = await hydrate(new Request(`http://127.0.0.1/api/collaboration/snapshot?${query}`, { headers: { "x-collaboration-secret": "recovery-fixture-collaboration-secret" } }));
        expect(response.status).toBe(200);
        const body = await response.json();
        const document = new Y.Doc();
        Y.applyUpdate(document, Buffer.from(body.data.state, "base64"));
        expect(document.getText("content").toString()).toBe(expected);
        document.destroy();
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("rolls back a real MongoDB restore transaction when its audit insert is rejected", async () => {
    const before = {
      tree: await db.templateFile.findUnique({ where: { playgroundId: "recovery-native" } }),
      project: await db.playground.findUnique({ where: { id: "recovery-native" } }),
      checkpoints: await db.collaborationDocument.findMany({ orderBy: { id: "asc" } }),
      snapshots: await db.playgroundSnapshot.findMany({ orderBy: { id: "asc" } }),
      events: await db.playgroundHistoryEvent.findMany({ orderBy: { id: "asc" } }),
    };
    // A controlled server-side validator causes a genuine MongoDB transaction failure.
    await db.$runCommandRaw({ collMod: "PlaygroundHistoryEvent", validator: { type: { $ne: "SNAPSHOT_RESTORED" } }, validationLevel: "strict", validationAction: "error" });
    try {
      expect(await restorePlaygroundSnapshot("recovery-native", "recovery-snapshot-original", 3)).toMatchObject({ success: false });
      const after = {
        tree: await db.templateFile.findUnique({ where: { playgroundId: "recovery-native" } }),
        project: await db.playground.findUnique({ where: { id: "recovery-native" } }),
        checkpoints: await db.collaborationDocument.findMany({ orderBy: { id: "asc" } }),
        snapshots: await db.playgroundSnapshot.findMany({ orderBy: { id: "asc" } }),
        events: await db.playgroundHistoryEvent.findMany({ orderBy: { id: "asc" } }),
      };
      expect(digest(after)).toBe(digest(before));
    } finally { await db.$runCommandRaw({ collMod: "PlaygroundHistoryEvent", validator: {} }); }
  });

  it("restores an immutable snapshot on recovered MongoDB with a new version, safety copy and full audit", async () => {
    const original = await db.playgroundSnapshot.findUnique({ where: { id: "recovery-snapshot-original" } });
    const result = await restorePlaygroundSnapshot("recovery-native", "recovery-snapshot-original", 3);
    expect(result).toMatchObject({ success: true, data: { version: 4 } });
    if (!result.success) throw new Error("Recovered restore failed");
    expect(await db.playgroundSnapshot.findUnique({ where: { id: "recovery-snapshot-original" } })).toEqual(original);
    expect(await db.playgroundSnapshot.findUnique({ where: { id: result.data.restorePointId } })).toMatchObject({ content: tree("saved v3 😀\n"), templateVersion: 3 });
    const history = await listPlaygroundHistory("recovery-native");
    expect(history).toMatchObject({ success: true, data: { currentVersion: 4 } });
    if (!history.success) throw new Error("History unavailable");
    expect(history.data.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "SNAPSHOT_RESTORED", previousVersion: 3, resultingVersion: 4, snapshotVersion: 1, collaborationRevision: 4, restorePointId: result.data.restorePointId }), expect.objectContaining({ type: "SNAPSHOT_DELETED", snapshotName: "Earlier removed copy" })]));
    expect((await db.collaborationDocument.findMany()).map(document => document.filePath)).toEqual([".liveide/notes"]);
  });
});

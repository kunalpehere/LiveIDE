import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({ currentUser: async () => ({ id: "mock-user-1", name: "Owner" }) }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { GET, POST } from "@/app/api/collaboration/snapshot/route";
import { mockDb } from "@/lib/mock-db";
import { createPlaygroundSnapshot, restorePlaygroundSnapshot } from "@/features/playground/actions/history";
import { collaborationRoom, PROJECT_NOTES_PATH } from "@/lib/collaboration-protocol.mjs";
afterEach(() => vi.unstubAllEnvs());
const identity = { protocolVersion: 1, playgroundId: "mock-playground-2", filePath: PROJECT_NOTES_PATH, revision: 1, room: collaborationRoom("mock-playground-2", PROJECT_NOTES_PATH) };
const secret = "notes-snapshot-fixture-secret";
const load = () => GET(new Request(`http://localhost/api/collaboration/snapshot?${new URLSearchParams(Object.entries(identity).map(([key, value]) => [key, String(value)]))}`, { headers: { "x-collaboration-secret": secret } }));
it("hydrates empty notes without seeding starter source", async () => {
  vi.stubEnv("COLLABORATION_SECRET", secret);
  const source = vi.spyOn(mockDb.templateFile, "findFirst");
  expect((await (await load()).json()).data.content).toBe("");
  expect(source).not.toHaveBeenCalled(); source.mockRestore();
});
it("persists notes separately and retains them through a real source snapshot restore", async () => {
  vi.stubEnv("COLLABORATION_SECRET", secret);
  const doc = new Y.Doc(); doc.getText("content").insert(0, "# Project decisions");
  const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"); doc.destroy();
  const response = await POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "content-type": "application/json", "x-collaboration-secret": secret }, body: JSON.stringify({ ...identity, state }) }));
  expect(response.status).toBe(200);
  const snapshot = await createPlaygroundSnapshot(identity.playgroundId, "Code checkpoint");
  if (!snapshot.success) throw new Error(snapshot.message);
  expect(JSON.stringify(snapshot.data)).not.toContain("Project decisions");
  expect(await restorePlaygroundSnapshot(identity.playgroundId, snapshot.data.id)).toMatchObject({ success: true });
  expect((await (await load()).json()).data.state).toBe(state);
  // Notes remain writable at their stable revision after the source advances.
  expect((await POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "content-type": "application/json", "x-collaboration-secret": secret }, body: JSON.stringify({ ...identity, state }) }))).status).toBe(200);
});

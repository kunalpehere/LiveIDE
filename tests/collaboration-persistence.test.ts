import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  templateFindFirst: vi.fn(),
  projectFindUnique: vi.fn(), fence: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {
  $transaction: async (callback: any) => callback({ playground: { findUnique: mocks.projectFindUnique, updateMany: mocks.fence }, collaborationDocument: { upsert: mocks.upsert, findMany: mocks.findMany } }),
  collaborationDocument: { findUnique: mocks.findUnique, upsert: mocks.upsert },
  templateFile: { findFirst: mocks.templateFindFirst },
  playground: { findUnique: mocks.projectFindUnique },
} }));
vi.mock("@/features/playground/lib/starter-template-service", () => ({ getStarterTemplate: vi.fn() }));

import { collaborationRoom } from "@/lib/collaboration-token";
import { GET, POST } from "@/app/api/collaboration/snapshot/route";

const secret = "persistence-test-secret";
const room = collaborationRoom("project-1", "src/App.tsx");

describe("collaboration snapshot persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COLLABORATION_SECRET", secret);
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    mocks.projectFindUnique.mockResolvedValue({ collaborationRevision: 1, updatedAt: new Date(0) });
    mocks.fence.mockResolvedValue({ count: 1 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not accept the authentication secret when collaboration is disabled", async () => {
    vi.stubEnv("COLLABORATION_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "");
    vi.stubEnv("AUTH_SECRET", "old-auth-fallback");
    const response = await POST(new Request("http://localhost/api/collaboration/snapshot", {
      method: "POST", headers: { "x-collaboration-secret": "old-auth-fallback" },
    }));
    expect(response.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects requests without the service secret", async () => {
    const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?protocolVersion=1&playgroundId=project-1&filePath=src%2FApp.tsx&room=${encodeURIComponent(room)}&revision=1`));
    expect(response.status).toBe(401);
  });

  it("upserts a bounded, room-scoped CRDT snapshot", async () => {
    const response = await POST(new Request("http://localhost/api/collaboration/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-collaboration-secret": secret },
      body: JSON.stringify({ protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: "AQID" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { room } }));
  });

  it("returns the persisted CRDT state before canonical file content", async () => {
    mocks.findUnique.mockResolvedValue({ room, state: "AAA=" });
    const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?protocolVersion=1&playgroundId=project-1&filePath=src%2FApp.tsx&room=${encodeURIComponent(room)}&revision=1`, {
      headers: { "x-collaboration-secret": secret },
    }));
    expect(await response.json()).toEqual({ success: true, data: { protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", revision: 1, room, state: "AAA=" } });
    expect(mocks.templateFindFirst).not.toHaveBeenCalled();
  });
  it("accepts a checkpoint at 2 MiB and rejects the next byte before persistence", async () => {
    const save = (size: number) => POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "x-collaboration-secret": secret }, body: JSON.stringify({ protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: Buffer.alloc(size).toString("base64") }) }));
    expect((await save(2 * 1024 * 1024)).status).toBe(200);
    mocks.upsert.mockClear();
    const rejected = await save(2 * 1024 * 1024 + 1);
    expect(rejected.status).toBe(413);
    expect((await rejected.json()).error.code).toBe("CHECKPOINT_SIZE_LIMIT");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("bounds checkpoint count and aggregate storage without overwriting existing state", async () => {
    const save = () => POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "x-collaboration-secret": secret }, body: JSON.stringify({ protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: "AAA=" }) }));
    mocks.findMany.mockResolvedValue(Array.from({ length: 251 }, (_, i) => ({ room: String(i), state: "AAA=" })));
    expect((await save()).status).toBe(409);
    mocks.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({ room: String(i), state: Buffer.alloc(2 * 1024 * 1024).toString("base64") })));
    expect((await save()).status).toBe(413);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects incompatible versions and room/revision mismatches before writing", async () => {
    for (const changes of [{ protocolVersion: 2 }, { revision: 2 }, { role: "OWNER" }, { filePath: "../secret" }]) {
      const response = await POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST",
        headers: { "content-type": "application/json", "x-collaboration-secret": secret },
        body: JSON.stringify({ protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: "AAA=", ...changes }),
      }));
      expect([400, 409, 426]).toContain(response.status);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects old checkpoints and reads after restore, and a conflicting conditional fence", async () => {
    const save = () => POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "content-type": "application/json", "x-collaboration-secret": secret }, body: JSON.stringify({ protocolVersion: 1, playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: "AAA=" }) }));
    mocks.projectFindUnique.mockResolvedValue({ collaborationRevision: 2, updatedAt: new Date(0) });
    expect((await save()).status).toBe(409); expect(mocks.upsert).not.toHaveBeenCalled();
    expect((await GET(new Request(`http://localhost/api/collaboration/snapshot?protocolVersion=1&playgroundId=project-1&filePath=src%2FApp.tsx&room=${encodeURIComponent(room)}&revision=1`, { headers: { "x-collaboration-secret": secret } }))).status).toBe(409);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    mocks.projectFindUnique.mockResolvedValue({ collaborationRevision: 1, updatedAt: new Date(0) }); mocks.fence.mockResolvedValue({ count: 0 });
    expect((await save()).status).toBe(409); expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

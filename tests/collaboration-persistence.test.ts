import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  templateFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {
  collaborationDocument: { findUnique: mocks.findUnique, upsert: mocks.upsert },
  templateFile: { findFirst: mocks.templateFindFirst },
  playground: { findUnique: vi.fn() },
} }));
vi.mock("@/features/playground/lib/starter-template-service", () => ({ getStarterTemplate: vi.fn() }));

import { collaborationRoom } from "@/lib/collaboration-token";
import { GET, POST } from "@/app/api/collaboration/snapshot/route";

const secret = "persistence-test-secret";
const room = collaborationRoom("project-1", "src/App.tsx");

describe("collaboration snapshot persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLABORATION_SECRET = secret;
    mocks.findUnique.mockResolvedValue(null);
  });

  it("rejects requests without the service secret", async () => {
    const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?playgroundId=project-1&filePath=src%2FApp.tsx&room=${encodeURIComponent(room)}&revision=1`));
    expect(response.status).toBe(401);
  });

  it("upserts a bounded, room-scoped CRDT snapshot", async () => {
    const response = await POST(new Request("http://localhost/api/collaboration/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-collaboration-secret": secret },
      body: JSON.stringify({ playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, state: "AQID" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { room } }));
  });

  it("returns the persisted CRDT state before canonical file content", async () => {
    mocks.findUnique.mockResolvedValue({ room, state: "persisted-state" });
    const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?playgroundId=project-1&filePath=src%2FApp.tsx&room=${encodeURIComponent(room)}&revision=1`, {
      headers: { "x-collaboration-secret": secret },
    }));
    expect(await response.json()).toEqual({ success: true, data: { state: "persisted-state" } });
    expect(mocks.templateFindFirst).not.toHaveBeenCalled();
  });
});

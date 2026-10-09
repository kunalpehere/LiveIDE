import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { GET, POST } from "@/app/api/collaboration/snapshot/route";
import { collaborationRoom, PROJECT_PRESENCE_PATH, PROJECT_RUNTIME_PATH } from "@/lib/collaboration-protocol.mjs";
afterEach(() => vi.unstubAllEnvs());
it("hydrates snapshots through the real development mock delegate", async () => {
  vi.stubEnv("COLLABORATION_SECRET", "snapshot-mock-secret");
  const query = new URLSearchParams({ protocolVersion: "1", playgroundId: "mock-playground-1", filePath: "src/App.tsx",
    room: collaborationRoom("mock-playground-1", "src/App.tsx"), revision: "1" });
  const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?${query}`, { headers: { "x-collaboration-secret": "snapshot-mock-secret" } }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.content).toContain("Welcome to React TypeScript Starter");
});
it.each([PROJECT_PRESENCE_PATH, PROJECT_RUNTIME_PATH])("never hydrates ephemeral channel %s from stored file content", async filePath => {
  vi.stubEnv("COLLABORATION_SECRET", "snapshot-mock-secret");
  const query = new URLSearchParams({ protocolVersion: "1", playgroundId: "mock-playground-1", filePath,
    room: collaborationRoom("mock-playground-1", filePath), revision: "1" });
  const response = await GET(new Request(`http://localhost/api/collaboration/snapshot?${query}`, { headers: { "x-collaboration-secret": "snapshot-mock-secret" } }));
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("FORBIDDEN");
});
it("rejects attempts to save runtime state through the snapshot endpoint", async () => {
  vi.stubEnv("COLLABORATION_SECRET", "snapshot-mock-secret");
  const response = await POST(new Request("http://localhost/api/collaboration/snapshot", { method: "POST", headers: { "content-type": "application/json", "x-collaboration-secret": "snapshot-mock-secret" }, body: JSON.stringify({ protocolVersion: 1, playgroundId: "mock-playground-1", filePath: PROJECT_RUNTIME_PATH, room: collaborationRoom("mock-playground-1", PROJECT_RUNTIME_PATH), revision: 1, state: "AAA=" }) }));
  expect(response.status).toBe(400); expect((await response.json()).error.code).toBe("FORBIDDEN");
});

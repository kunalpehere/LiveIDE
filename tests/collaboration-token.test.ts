import { describe, expect, it } from "vitest";

import {
  collaborationRoom,
  createCollaborationToken,
  verifyCollaborationToken,
} from "@/lib/collaboration-token";

const claims = {
  playgroundId: "project-1",
  room: collaborationRoom("project-1", "src/App.tsx", 1),
  filePath: "src/App.tsx",
  revision: 1,
  userId: "user-1",
  name: "Editor One",
  color: "#3b82f6",
};

describe("collaboration access tokens", () => {
  it("creates stable, file-scoped room identifiers", () => {
    expect(claims.room).toBe("project-1.r1.c3JjL0FwcC50c3g");
    expect(collaborationRoom("project-1", "src/App.tsx")).toBe(claims.room);
    expect(collaborationRoom("project-1", "src/Other.tsx")).not.toBe(claims.room);
  });

  it("round-trips signed editor claims", async () => {
    const token = await createCollaborationToken(claims, "test-secret-that-is-not-production");
    await expect(verifyCollaborationToken(token, "test-secret-that-is-not-production")).resolves.toMatchObject(claims);
  });

  it("rejects tokens verified with another secret", async () => {
    const token = await createCollaborationToken(claims, "correct-secret");
    await expect(verifyCollaborationToken(token, "wrong-secret")).rejects.toThrow();
  });
});

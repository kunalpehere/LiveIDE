import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const provider = vi.hoisted(() => ({ generate: vi.fn(), stream: vi.fn(), model: "test" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
vi.mock("@/features/playground/lib/authorization", () => ({ requireCurrentUser: async () => ({ id: "chat-limit-user" }), requirePlaygroundAccess: async () => ({ role: "OWNER" }) }));
vi.mock("@/features/ai-chat/server/provider", () => ({ getAIProvider: () => provider, createAIAbortSignal: () => new AbortController().signal }));
import { GET, POST } from "@/app/api/chat/route";
import { mockDb } from "@/lib/mock-db";
import { RESOURCE_LIMITS } from "@/lib/resource-limits";

let projectId: string;
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const history = () => GET(new NextRequest(`http://localhost/api/chat?playgroundId=${projectId}`));
describe("chat storage and output limits", () => {
  beforeEach(async () => {
    const project = await mockDb.playground.create({ data: { title: "Chat limits", template: "REACT", userId: "chat-limit-user" } });
    projectId = project.id;
    provider.generate.mockResolvedValue("answer");
  });
  it("keeps the latest 100 messages in chronological order and isolates users", async () => {
    for (let i = 0; i < 100; i++) await mockDb.chatMessage.create({ data: { userId: "chat-limit-user", playgroundId: projectId, role: "user", content: `old-${i}` } });
    await mockDb.chatMessage.create({ data: { userId: "other-user", playgroundId: projectId, role: "user", content: "private" } });
    expect((await post({ message: "latest", playgroundId: projectId })).status).toBe(200);
    const result = await (await history()).json();
    expect(result.messages).toHaveLength(100);
    expect(result.messages.at(-1).content).toBe("answer");
    expect(result.messages.at(-2).content).toBe("latest");
    expect(result.messages.some((message: { content: string }) => message.content === "private")).toBe(false);
    expect(await mockDb.chatMessage.findMany({ where: { userId: "other-user", playgroundId: projectId } })).toHaveLength(1);
    expect(await mockDb.chatMessage.findMany({ where: { userId: "chat-limit-user", playgroundId: projectId } })).toHaveLength(100);
  });
  it("rejects oversized responses with remediation and never stores them", async () => {
    provider.generate.mockResolvedValue("x".repeat(RESOURCE_LIMITS.chatMessageBytes + 1));
    const response = await post({ message: "question", playgroundId: projectId });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "CHAT_RESPONSE_LIMIT", message: expect.stringContaining("narrower") } });
    const result = await (await history()).json();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });
  it("stops an oversized stream with a visible notice and no oversized persistence", async () => {
    provider.stream.mockResolvedValue(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(RESOURCE_LIMITS.chatMessageBytes)));
      controller.enqueue(new TextEncoder().encode("overflow"));
      controller.close();
    } }));
    const response = await post({ message: "question", playgroundId: projectId, stream: true });
    const text = await response.text();
    expect(text).toContain("Response stopped at 64 KiB");
    expect(text).not.toContain("overflow");
    expect((await (await history()).json()).messages).toHaveLength(1);
  });
  it("decodes multibyte characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode("hello 🌏");
    provider.stream.mockResolvedValue(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 8)); controller.enqueue(bytes.slice(8)); controller.close();
    } }));
    const response = await post({ message: "question", playgroundId: projectId, stream: true });
    expect(await response.text()).toBe("hello 🌏");
    expect((await (await history()).json()).messages.at(-1).content).toBe("hello 🌏");
  });
  it("rejects oversized request bodies before generation or persistence", async () => {
    provider.generate.mockClear();
    const response = await post({ message: "é".repeat(20_000), playgroundId: projectId });
    expect(response.status).toBe(413);
    expect(provider.generate).not.toHaveBeenCalled();
    expect((await (await history()).json()).messages).toHaveLength(0);
  });
  it("explains the input character limit even through the request union", async () => {
    const response = await post({ message: "x".repeat(12_001), playgroundId: projectId });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("Shorten") } });
  });
});

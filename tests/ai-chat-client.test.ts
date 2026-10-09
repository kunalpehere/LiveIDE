import { afterEach, describe, expect, it, vi } from "vitest";

import { requestChat } from "@/features/ai-chat/client/chat-api";

afterEach(() => vi.unstubAllGlobals());

const payload = {
  playgroundId: "project-one",
  message: "Help",
  history: [],
  stream: false,
  mode: "chat" as const,
};

describe("AI chat client", () => {
  it("keeps recent context within the request byte budget without mutating history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: "Answer", model: "test" }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const history = Array.from({ length: 10 }, (_, i) => ({ role: "assistant" as const, content: String(i) + "é".repeat(3_999) }));
    await requestChat({ ...payload, history });
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(32_000);
    expect(JSON.parse(body).history.at(-1).content).toBe(history[9].content);
    expect(history).toHaveLength(10);
  });
  it("explains excessive input before sending a request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(requestChat({ ...payload, message: "é".repeat(20_000) })).rejects.toThrow(/Shorten/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("parses JSON chat responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: "Answer", model: "test-model",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(requestChat(payload)).resolves.toEqual({ response: "Answer", model: "test-model" });
  });

  it("delivers streamed text incrementally", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one "));
        controller.enqueue(new TextEncoder().encode("two"));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200, headers: { "Content-Type": "text/plain", "X-AI-Model": "stream-model" },
    })));
    const chunks: string[] = [];
    const result = await requestChat({ ...payload, stream: true }, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["one ", "two"]);
    expect(result).toEqual({ response: "one two", model: "stream-model" });
  });

  it("surfaces the structured API message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "RATE_LIMITED", message: "Retry shortly" },
    }), { status: 429, headers: { "Content-Type": "application/json" } })));
    await expect(requestChat(payload)).rejects.toThrow("Retry shortly");
  });
});

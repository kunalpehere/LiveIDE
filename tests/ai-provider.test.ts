import { afterEach, describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "@/features/ai-chat/server/provider";

afterEach(() => vi.unstubAllGlobals());

describe("OllamaProvider", () => {
  it("uses the configured model and validates the provider response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: " answer " }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider();

    await expect(provider.generate("prompt")).resolves.toBe("answer");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe(provider.model);
    expect(request.stream).toBe(false);
  });

  it("converts Ollama NDJSON streaming output into text chunks", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"response":"one "}\n{"response":"two"}\n'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(source, { status: 200 })));
    const reader = (await new OllamaProvider().stream("prompt")).getReader();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    expect(output).toBe("one two");
  });
});

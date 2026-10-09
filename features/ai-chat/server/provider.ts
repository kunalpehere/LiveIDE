import { z } from "zod";
import { AIRequestError } from "./security";
import { assertChatMessage, readLimitedBody } from "@/lib/resource-limits";

const ollamaResponseSchema = z.object({ response: z.string() });

export interface AIProvider {
  readonly model: string;
  generate(prompt: string, options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string>;
  stream(prompt: string, options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
}

export interface AIConfiguration {
  configured: boolean;
  provider: string;
  model: string;
}

type GenerationOptions = { maxTokens?: number; temperature?: number; signal?: AbortSignal };

export class OllamaProvider implements AIProvider {
  readonly model = process.env.AI_MODEL || process.env.OLLAMA_MODEL || "codellama:latest";
  private readonly baseUrl = (process.env.AI_PROVIDER_URL || process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

  private body(prompt: string, stream: boolean, maxTokens = 1_000, temperature = 0.7) {
    return JSON.stringify({ model: this.model, prompt, stream, options: { temperature, num_predict: maxTokens } });
  }

  async generate(prompt: string, options: GenerationOptions = {}) {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: this.body(prompt, false, options.maxTokens, options.temperature), signal: options.signal,
    });
    if (!response.ok) throw new AIRequestError(502, "PROVIDER_ERROR", `AI provider returned ${response.status}`);
    const parsed = ollamaResponseSchema.safeParse(JSON.parse(await readLimitedBody(response, 512 * 1024)));
    if (!parsed.success || !parsed.data.response.trim()) throw new AIRequestError(502, "INVALID_PROVIDER_RESPONSE", "AI provider returned an invalid response");
    assertChatMessage(parsed.data.response);
    return parsed.data.response.trim();
  }

  async stream(prompt: string, options: GenerationOptions = {}) {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: this.body(prompt, true, options.maxTokens, options.temperature), signal: options.signal,
    });
    if (!response.ok || !response.body) throw new AIRequestError(502, "PROVIDER_ERROR", `AI provider returned ${response.status}`);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk.byteLength > 512 * 1024) throw new AIRequestError(413, "PROVIDER_RESPONSE_LIMIT", "AI provider sent too much data. Ask a narrower question and retry.");
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 512 * 1024) throw new AIRequestError(413, "PROVIDER_RESPONSE_LIMIT", "AI provider sent an oversized stream record. Ask a narrower question and retry.");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = ollamaResponseSchema.safeParse(JSON.parse(line));
          if (parsed.success) controller.enqueue(encoder.encode(parsed.data.response));
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          const parsed = ollamaResponseSchema.safeParse(JSON.parse(buffer));
          if (parsed.success) controller.enqueue(encoder.encode(parsed.data.response));
        }
      },
    }));
  }
}

export function getAIProvider(): AIProvider {
  const configuration = getAIConfiguration();
  if (!configuration.configured) {
    throw new AIRequestError(503, "AI_NOT_CONFIGURED", "AI is disabled. Configure a provider and set AI_ENABLED=true.");
  }
  const provider = configuration.provider;
  if (provider !== "ollama") throw new AIRequestError(500, "INVALID_AI_CONFIG", `Unsupported AI provider: ${provider}`);
  return new OllamaProvider();
}

export function getAIConfiguration(): AIConfiguration {
  return {
    configured: process.env.AI_ENABLED?.toLowerCase() === "true",
    provider: process.env.AI_PROVIDER || "ollama",
    model: process.env.AI_MODEL || process.env.OLLAMA_MODEL || "codellama:latest",
  };
}

export function createAIAbortSignal(request: Request) {
  const timeout = Math.max(1_000, Math.min(Number(process.env.AI_TIMEOUT_MS || 20_000), 120_000));
  return AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
}

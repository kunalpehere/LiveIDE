import type { ChatMessage, ChatMode } from "../types";
import { RESOURCE_LIMITS, utf8Bytes } from "@/lib/resource-limits";

interface ChatPayload {
  playgroundId: string;
  message: string;
  history: Array<Pick<ChatMessage, "role" | "content">>;
  stream: boolean;
  mode: ChatMode;
}

export interface ChatResponse {
  response: string;
  model: string;
  tokens?: number;
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message || `AI request failed with status ${response.status}`);
}

export async function requestChat(payload: ChatPayload, onChunk?: (chunk: string) => void): Promise<ChatResponse> {
  const bounded = { ...payload, history: payload.history.slice(-10).map(message => ({ ...message, content: message.content.slice(-4_000) })) };
  let body = JSON.stringify(bounded);
  while (bounded.history.length && utf8Bytes(body) > RESOURCE_LIMITS.chatRequestBytes) {
    bounded.history.shift();
    body = JSON.stringify(bounded);
  }
  if (utf8Bytes(body) > RESOURCE_LIMITS.chatRequestBytes) throw new Error("Chat request exceeds 32,000 bytes. Shorten your question or attached context and retry.");
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) throw await responseError(response);

  if (response.headers.get("content-type")?.startsWith("text/plain") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let complete = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      complete += chunk;
      onChunk?.(chunk);
    }
    return { response: complete, model: response.headers.get("x-ai-model") || "AI Assistant" };
  }

  return response.json() as Promise<ChatResponse>;
}

export async function loadChatHistory(playgroundId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/chat?playgroundId=${encodeURIComponent(playgroundId)}`, { signal });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<{ messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }> }>;
}

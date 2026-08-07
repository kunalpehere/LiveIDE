import type { ChatMessage, ChatMode } from "../types";

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
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

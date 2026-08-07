import { type NextRequest, NextResponse } from "next/server";

import { requireCurrentUser, requirePlaygroundAccess } from "@/features/playground/lib/authorization";
import { db } from "@/lib/db";
import { createAIAbortSignal, getAIProvider } from "@/features/ai-chat/server/provider";
import { chatRequestSchema, historyQuerySchema } from "@/features/ai-chat/server/schemas";
import { aiErrorResponse, enforceRateLimit, parseLimitedJson, redactSensitiveContent } from "@/features/ai-chat/server/security";

const systemPrompt = `You are an expert coding assistant. Give concise, practical, secure answers. Use language-labelled code blocks when providing code.`;

function buildChatPrompt(history: Array<{ role: string; content: string }>, message: string) {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: message },
  ].map(item => `${item.role}: ${redactSensitiveContent(item.content)}`).join("\n\n");
}

async function persistMessage(userId: string, playgroundId: string | undefined, role: "user" | "assistant", content: string) {
  if (!playgroundId) return;
  await db.chatMessage.create({ data: { userId, playgroundId, role, content } });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const body = await parseLimitedJson(request, chatRequestSchema);
    enforceRateLimit(user.id, body.action === "enhance" ? "enhance" : "chat", body.action === "enhance" ? 10 : 20);
    const provider = getAIProvider();
    const signal = createAIAbortSignal(request);

    if (body.action === "enhance") {
      const context = body.context ? redactSensitiveContent(JSON.stringify(body.context)) : "No additional context";
      const prompt = `Improve this coding request while preserving its intent. Return only the enhanced request.\n\nRequest: ${redactSensitiveContent(body.prompt)}\n\nContext: ${context}`;
      const enhancedPrompt = await provider.generate(prompt, { maxTokens: 500, temperature: 0.3, signal });
      return NextResponse.json({ enhancedPrompt, model: provider.model });
    }

    if (body.playgroundId) await requirePlaygroundAccess(body.playgroundId);
    const safeMessage = redactSensitiveContent(body.message);
    const prompt = buildChatPrompt(body.history || [], safeMessage);
    await persistMessage(user.id, body.playgroundId, "user", safeMessage);

    if (body.stream) {
      const providerStream = await provider.stream(prompt, { signal });
      let completeResponse = "";
      const persistedStream = providerStream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          completeResponse += new TextDecoder().decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        async flush() {
          if (completeResponse) await persistMessage(user.id, body.playgroundId, "assistant", completeResponse);
        },
      }));
      return new Response(persistedStream, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-AI-Model": provider.model },
      });
    }

    const response = await provider.generate(prompt, { signal });
    await persistMessage(user.id, body.playgroundId, "assistant", response);
    return NextResponse.json({ response, model: provider.model, timestamp: new Date().toISOString() });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const query = historyQuerySchema.safeParse({ playgroundId: request.nextUrl.searchParams.get("playgroundId") });
    if (!query.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "playgroundId is required" } }, { status: 400 });
    await requirePlaygroundAccess(query.data.playgroundId);
    const messages = await db.chatMessage.findMany({
      where: { userId: user.id, playgroundId: query.data.playgroundId },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return NextResponse.json({ messages });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { observeRoute } from "@/lib/observe-route";

import { requireCurrentUser, requirePlaygroundAccess } from "@/features/playground/lib/authorization";
import { db } from "@/lib/db";
import { assertChatMessage, RESOURCE_LIMITS } from "@/lib/resource-limits";
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
  assertChatMessage(content);
  if (!playgroundId) return;
  await db.$transaction(async tx => {
    const project = await tx.playground.findUniqueOrThrow({ where: { id: playgroundId }, select: { updatedAt: true } });
    await tx.playground.update({ where: { id: playgroundId }, data: { updatedAt: new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1)) } });
    await tx.chatMessage.create({ data: { userId, playgroundId, role, content } });
    const older = await tx.chatMessage.findMany({ where: { userId, playgroundId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: RESOURCE_LIMITS.chatMessages, select: { id: true } });
    if (older.length) await tx.chatMessage.deleteMany({ where: { id: { in: older.map(item => item.id) }, userId, playgroundId } });
  });
}

async function handlePOST(request: NextRequest) {
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
      assertChatMessage(enhancedPrompt);
      return NextResponse.json({ enhancedPrompt, model: provider.model });
    }

    if (body.playgroundId) await requirePlaygroundAccess(body.playgroundId);
    const safeMessage = redactSensitiveContent(body.message);
    const prompt = buildChatPrompt(body.history || [], safeMessage);
    await persistMessage(user.id, body.playgroundId, "user", safeMessage);

    if (body.stream) {
      const providerStream = await provider.stream(prompt, { signal });
      let completeResponse = "";
      let responseBytes = 0;
      const decoder = new TextDecoder();
      const persistedStream = providerStream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          responseBytes += chunk.byteLength;
          if (responseBytes > RESOURCE_LIMITS.chatMessageBytes) {
            controller.enqueue(new TextEncoder().encode("\n[Response stopped at 64 KiB. Ask a narrower question or request smaller sections.]"));
            controller.terminate();
            return;
          }
          completeResponse += decoder.decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        async flush() {
          completeResponse += decoder.decode();
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

async function handleGET(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const query = historyQuerySchema.safeParse({ playgroundId: request.nextUrl.searchParams.get("playgroundId") });
    if (!query.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "playgroundId is required" } }, { status: 400 });
    await requirePlaygroundAccess(query.data.playgroundId);
    const messages = await db.chatMessage.findMany({
      where: { userId: user.id, playgroundId: query.data.playgroundId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RESOURCE_LIMITS.chatMessages,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return NextResponse.json({ messages: messages.reverse(), retention: "The latest 100 messages per user and project are retained." });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export const POST = observeRoute("/api/chat", handlePOST);
export const GET = observeRoute("/api/chat", handleGET);

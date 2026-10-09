import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, errorDetails } from "@/lib/errors";
import { requirePlaygroundEditor } from "@/features/playground/lib/authorization";
import { getCollaborationConfiguration } from "@/lib/runtime-config.mjs";
import { runtimeCommandSchema, runtimeControlInputSchema } from "@/lib/shared-runtime.mjs";
import { observeRoute } from "@/lib/observe-route";

const input = z.discriminatedUnion("action", [
  runtimeControlInputSchema.extend({ action: z.literal("request") }),
  z.object({ action: z.literal("verify"), playgroundId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), token: z.string().min(1).max(4096), clientId: z.number().int().nonnegative(), nonce: z.string().uuid() }).strict(),
]);
async function editorMember(playgroundId: string, ownerId: string, userId: string) {
  if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) return false;
  if (ownerId === userId) return true;
  return (await db.playgroundMember.findUnique({ where: { playgroundId_userId: { playgroundId, userId } } }))?.role === "EDITOR";
}
async function handlePOST(request: Request) {
  try {
    const data = input.parse(await request.json().catch(() => null));
    const { user, playground } = await requirePlaygroundEditor(data.playgroundId);
    const { secret, websocketUrl } = getCollaborationConfiguration();
    if (!secret || !websocketUrl) throw new AppError("RUNTIME_UNAVAILABLE", "Runtime sharing is unavailable", 503);
    const key = new TextEncoder().encode(secret);
    if (data.action === "request") {
      if (data.revision !== playground.collaborationRevision || !await editorMember(data.playgroundId, playground.userId, data.targetUserId)) throw new AppError("RUNTIME_FORBIDDEN", "The runtime host is unavailable or no longer authorized", 403);
      const { action: _action, ...operation } = data;
      const requestId = randomUUID();
      const token = await new SignJWT({ ...operation, requestId, requesterId: user.id, scope: "runtime:control" }).setProtectedHeader({ alg: "HS256" }).setIssuer("liveide-runtime").setAudience("liveide-runtime-host").setIssuedAt().setExpirationTime("30s").sign(key);
      return Response.json({ success: true, data: { requestId, token } }, { headers: { "cache-control": "no-store" } });
    }
    const { payload } = await jwtVerify(data.token, key, { algorithms: ["HS256"], issuer: "liveide-runtime", audience: "liveide-runtime-host" });
    // jose's issuer/audience metadata is verified above; the rest is strict.
    const { iss: _issuer, aud: _audience, ...body } = payload;
    const command = runtimeCommandSchema.parse(body);
    if (command.exp - command.iat > 30 || command.iat > Math.floor(Date.now() / 1000) + 5 || command.playgroundId !== data.playgroundId || command.revision !== playground.collaborationRevision || command.targetUserId !== user.id || command.targetClientId !== data.clientId || command.targetNonce !== data.nonce || !await editorMember(data.playgroundId, playground.userId, command.requesterId)) throw new AppError("RUNTIME_FORBIDDEN", "Runtime request is expired or no longer authorized", 403);
    return Response.json({ success: true, data: { requestId: command.requestId, operation: command.operation, requesterId: command.requesterId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const details = errorDetails(error);
    const tokenError = error instanceof Error && error.name.startsWith("JWT") || typeof error === "object" && error !== null && "code" in error && String(error.code).startsWith("ERR_J");
    return Response.json({ success: false, message: tokenError ? "Invalid or expired runtime request" : details.message }, { status: tokenError ? 403 : details.status });
  }
}
export const POST = observeRoute("/api/collaboration/runtime-control", handlePOST);

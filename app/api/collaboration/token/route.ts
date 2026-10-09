import { PROTOCOL_VERSION, documentRevision, tokenRequestSchema, tokenResponseSchema, requireProtocolVersion, CollaborationProtocolError, protocolErrorResponse } from "@/lib/collaboration-protocol.mjs";
import { observeRoute } from "@/lib/observe-route";

import { requirePlaygroundAccess } from "@/features/playground/lib/authorization";
import { collaborationRoom, createCollaborationToken } from "@/lib/collaboration-token";
import { errorDetails } from "@/lib/errors";
import { getCollaborationConfiguration } from "@/lib/runtime-config.mjs";

const colors = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#06b6d4"];
function userColor(userId: string) {
  let hash = 0;
  for (const character of userId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

async function handlePOST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw new CollaborationProtocolError("MALFORMED_MESSAGE"); }
    requireProtocolVersion(body);
    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new CollaborationProtocolError("MALFORMED_MESSAGE");
    }

    const { websocketUrl, secret } = getCollaborationConfiguration();
    if (!websocketUrl || !secret) {
      return Response.json(protocolErrorResponse("UNAVAILABLE"), { status: 503 });
    }

    const { user, playground, role } = await requirePlaygroundAccess(parsed.data.playgroundId);
    const revision = documentRevision(playground.collaborationRevision, parsed.data.filePath);
    const room = collaborationRoom(parsed.data.playgroundId, parsed.data.filePath, revision);
    const name = user.name || user.email || "Collaborator";
    const color = userColor(user.id);
    const token = await createCollaborationToken({ playgroundId: parsed.data.playgroundId, room, filePath: parsed.data.filePath, revision, role, userId: user.id, name, color }, secret);

    return Response.json(tokenResponseSchema.parse({ success: true, data: { protocolVersion: PROTOCOL_VERSION, playgroundId: parsed.data.playgroundId, filePath: parsed.data.filePath,
      revision, role, websocketUrl, token, room, user: { id: user.id, name, color } } }));
  } catch (error) {
    if (error instanceof CollaborationProtocolError) return Response.json(protocolErrorResponse(error.code), { status: error.code === "VERSION_MISMATCH" ? 426 : error.code === "FORBIDDEN" ? 403 : 400 });
    const details = errorDetails(error);
    const code = details.status === 401 ? "UNAUTHORIZED" : details.status === 403 ? "FORBIDDEN" : "UNAVAILABLE";
    return Response.json(protocolErrorResponse(code), { status: details.status });
  }
}

export const POST = observeRoute("/api/collaboration/token", handlePOST);

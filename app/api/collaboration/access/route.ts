import { db } from "@/lib/db";
import { requireCollaborationService } from "@/lib/collaboration-service-auth";
import { verifyCollaborationToken } from "@/lib/collaboration-token";
import { accessResponseSchema, documentRevision, CollaborationProtocolError, protocolErrorResponse, PROTOCOL_VERSION } from "@/lib/collaboration-protocol.mjs";
import { observeRoute } from "@/lib/observe-route";

async function handlePOST(request: Request) {
  try {
    const secret = requireCollaborationService(request);
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ") || bearer.length > 8200) throw new CollaborationProtocolError("UNAUTHORIZED");
    const claims = await verifyCollaborationToken(bearer.slice(7), secret);
    const user = await db.user.findUnique({ where: { id: claims.userId }, select: { id: true } });
    if (!user) throw new CollaborationProtocolError("UNAUTHORIZED");
    const playground = await db.playground.findUnique({ where: { id: claims.playgroundId } });
    if (!playground) throw new CollaborationProtocolError("FORBIDDEN");
    if (documentRevision(playground.collaborationRevision, claims.filePath) !== claims.revision) throw new CollaborationProtocolError("ROOM_MISMATCH");
    const membership = playground.userId === claims.userId ? null : await db.playgroundMember.findUnique({ where: { playgroundId_userId: { playgroundId: claims.playgroundId, userId: claims.userId } } });
    const role = playground.userId === claims.userId ? "OWNER" : membership?.role;
    if (!role || role !== claims.role) throw new CollaborationProtocolError("FORBIDDEN");
    return Response.json(accessResponseSchema.parse({ success: true, data: { protocolVersion: PROTOCOL_VERSION, playgroundId: claims.playgroundId,
      filePath: claims.filePath, revision: claims.revision, room: claims.room, role } }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CollaborationProtocolError) return Response.json(protocolErrorResponse(error.code), { status: error.code === "ROOM_MISMATCH" ? 409 : error.code === "UNAUTHORIZED" ? 401 : 403 });
    if (typeof error === "object" && error && "code" in error && String(error.code).startsWith("ERR_J")) return Response.json(protocolErrorResponse("UNAUTHORIZED"), { status: 401 });
    throw error;
  }
}
export const POST = observeRoute("/api/collaboration/access", handlePOST);

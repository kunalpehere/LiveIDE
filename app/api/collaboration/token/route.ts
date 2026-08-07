import { z } from "zod";

import { requirePlaygroundEditor } from "@/features/playground/lib/authorization";
import { collaborationRoom, createCollaborationToken } from "@/lib/collaboration-token";
import { errorDetails } from "@/lib/errors";

const requestSchema = z.object({
  playgroundId: z.string().min(1).max(128),
  filePath: z.string().min(1).max(1024),
});

const colors = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#06b6d4"];
function userColor(userId: string) {
  let hash = 0;
  for (const character of userId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid collaboration request" } }, { status: 400 });
    }

    const websocketUrl = process.env.NEXT_PUBLIC_COLLABORATION_URL;
    const secret = process.env.COLLABORATION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!websocketUrl || !secret) {
      return Response.json({ error: { code: "COLLABORATION_DISABLED", message: "Real-time collaboration is not configured" } }, { status: 503 });
    }

    const { user, playground } = await requirePlaygroundEditor(parsed.data.playgroundId);
    const revision = playground.collaborationRevision;
    const room = collaborationRoom(parsed.data.playgroundId, parsed.data.filePath, revision);
    const name = user.name || user.email || "Collaborator";
    const color = userColor(user.id);
    const token = await createCollaborationToken({ playgroundId: parsed.data.playgroundId, room, filePath: parsed.data.filePath, revision, userId: user.id, name, color }, secret);

    return Response.json({ success: true, data: { websocketUrl, token, room, user: { id: user.id, name, color } } });
  } catch (error) {
    const details = errorDetails(error);
    return Response.json({ error: { code: details.code, message: details.message } }, { status: details.status });
  }
}

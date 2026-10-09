import { timingSafeEqual } from "node:crypto";
import { PROTOCOL_VERSION, ephemeralDocument, PROJECT_NOTES_PATH, documentRevision, snapshotQuerySchema, snapshotSaveSchema, snapshotResponseSchema, requireProtocolVersion, assertRoom, CollaborationProtocolError, protocolErrorResponse } from "@/lib/collaboration-protocol.mjs";
import { observeRoute } from "@/lib/observe-route";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { readLimitedBody, RESOURCE_LIMITS } from "@/lib/resource-limits";
import { getStarterTemplate } from "@/features/playground/lib/starter-template-service";
import type { TemplateKey } from "@/lib/template";
import { getCollaborationConfiguration } from "@/lib/runtime-config.mjs";

function secretMatches(received: string | null, expected: string) {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function contentAtPath(root: unknown, filePath: string): string | null {
  if (!root || typeof root !== "object") return null;
  const parts = filePath.split("/").filter(Boolean);
  let items = (root as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isFile = index === parts.length - 1;
    const item = items.find(candidate => {
      if (!candidate || typeof candidate !== "object") return false;
      if (isFile && "filename" in candidate && "fileExtension" in candidate) {
        return `${candidate.filename}${candidate.fileExtension ? `.${candidate.fileExtension}` : ""}` === part;
      }
      return !isFile && "folderName" in candidate && candidate.folderName === part;
    }) as { content?: unknown; items?: unknown } | undefined;
    if (!item) return null;
    if (isFile) return typeof item.content === "string" ? item.content : null;
    items = item.items;
    if (!Array.isArray(items)) return null;
  }
  return null;
}

async function handleGET(request: Request) {
  const { secret } = getCollaborationConfiguration();
  if (!secret || !secretMatches(request.headers.get("x-collaboration-secret"), secret)) {
    return Response.json(protocolErrorResponse("UNAUTHORIZED"), { status: 401 });
  }
  const url = new URL(request.url);
  const query = { protocolVersion: Number(url.searchParams.get("protocolVersion")), playgroundId: url.searchParams.get("playgroundId"), filePath: url.searchParams.get("filePath"), room: url.searchParams.get("room"), revision: Number(url.searchParams.get("revision")) };
  requireProtocolVersion(query);
  const parsed = snapshotQuerySchema.safeParse(query);
  if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  assertRoom(parsed.data);
  if (ephemeralDocument(parsed.data.filePath)) throw new CollaborationProtocolError("FORBIDDEN");
  const currentProject = await db.playground.findUnique({ where: { id: parsed.data.playgroundId } });
  if (!currentProject || documentRevision(currentProject.collaborationRevision, parsed.data.filePath) !== parsed.data.revision) throw new CollaborationProtocolError("ROOM_MISMATCH");

  const collaborationDocument = await db.collaborationDocument.findUnique({ where: { room: parsed.data.room } });
  if (collaborationDocument) return Response.json(snapshotResponseSchema.parse({ success: true, data: { ...parsed.data, state: collaborationDocument.state } }));
  if (parsed.data.filePath === PROJECT_NOTES_PATH) return Response.json(snapshotResponseSchema.parse({ success: true, data: { ...parsed.data, content: "" } }));

  const templateFile = await db.templateFile.findFirst({ where: { playgroundId: parsed.data.playgroundId } });
  let root: unknown = templateFile?.content;
  if (!templateFile) {
    const playground = await db.playground.findUnique({ where: { id: parsed.data.playgroundId } });
    if (!playground) return Response.json({ error: { code: "NOT_FOUND", message: "Playground not found" } }, { status: 404 });
    root = await getStarterTemplate(playground.template as TemplateKey);
  }
  if (typeof root === "string") {
    try { root = JSON.parse(root); } catch { root = null; }
  }
  return Response.json(snapshotResponseSchema.parse({ success: true, data: { ...parsed.data, content: contentAtPath(root, parsed.data.filePath) || "" } }));
}

async function handlePOST(request: Request) {
  const { secret } = getCollaborationConfiguration();
  if (!secret || !secretMatches(request.headers.get("x-collaboration-secret"), secret)) {
    return Response.json(protocolErrorResponse("UNAUTHORIZED"), { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(await readLimitedBody(request, 3 * 1024 * 1024)); } catch (error) { if (error instanceof AppError) throw error; throw new CollaborationProtocolError("MALFORMED_MESSAGE"); }
  requireProtocolVersion(body);
  const parsed = snapshotSaveSchema.safeParse(body);
  if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  assertRoom(parsed.data);
  const { playgroundId, room, filePath, revision, state } = parsed.data;
  if (Buffer.from(state, "base64").byteLength > RESOURCE_LIMITS.checkpointBytes) throw new AppError("CHECKPOINT_SIZE_LIMIT", "Collaboration checkpoint exceeds 2 MiB. Save a smaller project and reconnect; contact the owner if checkpoint history remains too large.", 413);
  if (ephemeralDocument(filePath)) throw new CollaborationProtocolError("FORBIDDEN");
  const data = { playgroundId, room, filePath, state };
  await db.$transaction(async transaction => {
    // Write the same project row that restore updates: MongoDB detects a
    // conflicting revision change rather than allowing a stale-room insert.
    const project = await transaction.playground.findUnique({ where: { id: playgroundId } });
    if (!project || documentRevision(project.collaborationRevision, filePath) !== revision) throw new CollaborationProtocolError("ROOM_MISMATCH");
    const fence = await transaction.playground.updateMany({ where: { id: playgroundId, collaborationRevision: project.collaborationRevision }, data: { updatedAt: new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1)) } });
    if (fence.count !== 1) throw new CollaborationProtocolError("ROOM_MISMATCH");
    const checkpoints = await transaction.collaborationDocument.findMany({ where: { playgroundId }, take: RESOURCE_LIMITS.checkpoints + 1, select: { room: true, state: true } });
    const other = checkpoints.filter(checkpoint => checkpoint.room !== room);
    if (other.length >= RESOURCE_LIMITS.checkpoints) throw new AppError("CHECKPOINT_COUNT_LIMIT", "Project has reached 251 collaboration checkpoints. Ask the owner to save and restore a snapshot to clear old source checkpoints before reconnecting.", 409);
    const totalBytes = other.reduce((bytes, checkpoint) => bytes + Buffer.from(checkpoint.state, "base64").byteLength, Buffer.from(state, "base64").byteLength);
    if (totalBytes > RESOURCE_LIMITS.checkpointProjectBytes) throw new AppError("CHECKPOINT_STORAGE_LIMIT", "Project checkpoints exceed 8 MiB. Ask the owner to save and restore a snapshot to clear old source checkpoints before reconnecting.", 413);
    await transaction.collaborationDocument.upsert({
      where: { room },
      update: { state, filePath, playgroundId },
      create: data,
    });
  });
  return Response.json({ success: true, protocolVersion: PROTOCOL_VERSION });
}

function protocolHandler(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await handler(request); } catch (error) {
    if (error instanceof CollaborationProtocolError) return Response.json(protocolErrorResponse(error.code), { status: error.code === "VERSION_MISMATCH" ? 426 : error.code === "ROOM_MISMATCH" ? 409 : 400 });
      if (error instanceof AppError) return Response.json({ protocolVersion: PROTOCOL_VERSION, error: { code: error.code, message: error.message } }, { status: error.status });
      throw error;
    }
  };
}
export const GET = observeRoute("/api/collaboration/snapshot", protocolHandler(handleGET));
export const POST = observeRoute("/api/collaboration/snapshot", protocolHandler(handlePOST));

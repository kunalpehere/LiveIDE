import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { db } from "@/lib/db";
import { getStarterTemplate } from "@/features/playground/lib/starter-template-service";
import type { TemplateKey } from "@/lib/template";
import { collaborationRoom } from "@/lib/collaboration-token";

const querySchema = z.object({ playgroundId: z.string().min(1).max(128), filePath: z.string().min(1).max(1024), room: z.string().min(1).max(1536), revision: z.coerce.number().int().positive() });
const saveSchema = querySchema.extend({ state: z.string().min(1).max(3_000_000) });

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
        return `${candidate.filename}.${candidate.fileExtension}` === part;
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

export async function GET(request: Request) {
  const secret = process.env.COLLABORATION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || !secretMatches(request.headers.get("x-collaboration-secret"), secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ playgroundId: url.searchParams.get("playgroundId"), filePath: url.searchParams.get("filePath"), room: url.searchParams.get("room"), revision: url.searchParams.get("revision") });
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid snapshot request" } }, { status: 400 });
  if (collaborationRoom(parsed.data.playgroundId, parsed.data.filePath, parsed.data.revision) !== parsed.data.room) {
    return Response.json({ error: { code: "ROOM_MISMATCH", message: "Invalid room mapping" } }, { status: 400 });
  }

  const collaborationDocument = await db.collaborationDocument.findUnique({ where: { room: parsed.data.room } });
  if (collaborationDocument) return Response.json({ success: true, data: { state: collaborationDocument.state } });

  const templateFile = await db.templateFile.findFirst({ where: { playgroundId: parsed.data.playgroundId } });
  let root: unknown = templateFile?.content;
  if (!templateFile) {
    const playground = await db.playground.findUnique({ where: { id: parsed.data.playgroundId } });
    if (!playground) return Response.json({ error: { code: "NOT_FOUND", message: "Playground not found" } }, { status: 404 });
    root = { folderName: "Root", items: await getStarterTemplate(playground.template as TemplateKey) };
  }
  if (typeof root === "string") {
    try { root = JSON.parse(root); } catch { root = null; }
  }
  return Response.json({ success: true, data: { content: contentAtPath(root, parsed.data.filePath) || "" } });
}

export async function POST(request: Request) {
  const secret = process.env.COLLABORATION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || !secretMatches(request.headers.get("x-collaboration-secret"), secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  const parsed = saveSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid collaboration snapshot" } }, { status: 400 });
  if (collaborationRoom(parsed.data.playgroundId, parsed.data.filePath, parsed.data.revision) !== parsed.data.room) {
    return Response.json({ error: { code: "ROOM_MISMATCH", message: "Invalid room mapping" } }, { status: 400 });
  }
  await db.collaborationDocument.upsert({
    where: { room: parsed.data.room },
    update: { state: parsed.data.state, filePath: parsed.data.filePath, playgroundId: parsed.data.playgroundId },
    create: parsed.data,
  });
  return Response.json({ success: true });
}

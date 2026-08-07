"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { TemplateKey } from "@/lib/template";
import { requirePlaygroundAccess, requirePlaygroundEditor, requirePlaygroundOwner } from "../lib/authorization";
import { runPlaygroundAction } from "../lib/action-result";
import { getStarterTemplate } from "../lib/starter-template-service";
import { playgroundIdSchema } from "../lib/validation";

const snapshotNameSchema = z.string().trim().min(1).max(80);
const snapshotIdSchema = z.string().trim().min(1).max(128);

async function currentProjectContent(playgroundId: string, template: string) {
  const templateFile = await db.templateFile.findUnique({ where: { playgroundId } });
  if (templateFile) return { content: inputJson(templateFile.content), version: templateFile.version };
  const root = await getStarterTemplate(template as TemplateKey);
  return { content: inputJson(root), version: 0 };
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) throw new AppError("INVALID_PROJECT_CONTENT", "Project content is unavailable", 500);
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function actorName(user: { name?: string | null; email?: string | null }) {
  return user.name || user.email || "LiveIDE user";
}

export async function listPlaygroundHistory(playgroundId: string) {
  return runPlaygroundAction("listHistory", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { role } = await requirePlaygroundAccess(id);
    const [snapshots, events] = await Promise.all([
      db.playgroundSnapshot.findMany({
        where: { playgroundId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, name: true, kind: true, templateVersion: true, createdById: true, createdByName: true, createdAt: true },
      }),
      db.playgroundHistoryEvent.findMany({ where: { playgroundId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { currentRole: role, snapshots, events };
  });
}

export async function createPlaygroundSnapshot(playgroundId: string, name: unknown) {
  return runPlaygroundAction("createSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground, user } = await requirePlaygroundEditor(id);
    const snapshotName = snapshotNameSchema.parse(name);
    const current = await currentProjectContent(id, playground.template);
    const snapshot = await db.playgroundSnapshot.create({
      data: {
        playgroundId: id,
        name: snapshotName,
        kind: "MANUAL",
        content: current.content,
        templateVersion: current.version,
        createdById: user.id,
        createdByName: actorName(user),
      },
      select: { id: true, name: true, kind: true, templateVersion: true, createdById: true, createdByName: true, createdAt: true },
    });
    await db.playgroundHistoryEvent.create({ data: {
      playgroundId: id, type: "SNAPSHOT_CREATED", actorId: user.id, actorName: actorName(user), snapshotId: snapshot.id, snapshotName: snapshot.name,
    } });
    revalidatePath(`/playground/${id}`);
    return snapshot;
  });
}

export async function restorePlaygroundSnapshot(playgroundId: string, snapshotId: unknown) {
  return runPlaygroundAction("restoreSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground, user } = await requirePlaygroundEditor(id);
    const parsedSnapshotId = snapshotIdSchema.parse(snapshotId);
    const snapshot = await db.playgroundSnapshot.findFirst({ where: { id: parsedSnapshotId, playgroundId: id } });
    if (!snapshot) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found", 404);

    const current = await currentProjectContent(id, playground.template);
    await db.playgroundSnapshot.create({ data: {
      playgroundId: id,
      name: `Before restoring ${snapshot.name}`.slice(0, 80),
      kind: "RESTORE_POINT",
      content: current.content,
      templateVersion: current.version,
      createdById: user.id,
      createdByName: actorName(user),
    } });
    await db.templateFile.upsert({
      where: { playgroundId: id },
      update: { content: inputJson(snapshot.content), version: { increment: 1 } },
      create: { playgroundId: id, content: inputJson(snapshot.content), version: 1 },
    });
    await db.playground.update({ where: { id }, data: { collaborationRevision: { increment: 1 } } });
    await db.collaborationDocument.deleteMany({ where: { playgroundId: id } });
    await db.playgroundHistoryEvent.create({ data: {
      playgroundId: id, type: "SNAPSHOT_RESTORED", actorId: user.id, actorName: actorName(user), snapshotId: snapshot.id, snapshotName: snapshot.name,
    } });
    revalidatePath(`/playground/${id}`);
    return { snapshotId: snapshot.id, name: snapshot.name };
  });
}

export async function deletePlaygroundSnapshot(playgroundId: string, snapshotId: unknown) {
  return runPlaygroundAction("deleteSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { user } = await requirePlaygroundOwner(id);
    const parsedSnapshotId = snapshotIdSchema.parse(snapshotId);
    const snapshot = await db.playgroundSnapshot.findFirst({ where: { id: parsedSnapshotId, playgroundId: id } });
    if (!snapshot) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found", 404);
    await db.playgroundSnapshot.deleteMany({ where: { id: parsedSnapshotId, playgroundId: id } });
    await db.playgroundHistoryEvent.create({ data: {
      playgroundId: id, type: "SNAPSHOT_DELETED", actorId: user.id, actorName: actorName(user), snapshotId: snapshot.id, snapshotName: snapshot.name,
    } });
    revalidatePath(`/playground/${id}`);
    return { id: parsedSnapshotId };
  });
}

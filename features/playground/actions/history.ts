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
import { playgroundIdSchema, parseTemplateData } from "../lib/validation";
import { RESOURCE_LIMITS } from "@/lib/resource-limits";
import { PROJECT_NOTES_PATH } from "@/lib/collaboration-protocol.mjs";

const snapshotNameSchema = z.string().trim().min(1).max(80);
const snapshotIdSchema = z.string().trim().min(1).max(128);
const expectedVersionSchema = z.number().int().min(0).optional();

async function historyTransaction<T>(action: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try { return await db.$transaction(action); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      throw new AppError("HISTORY_CONFLICT", "Project history changed in another session. Refresh history and try again.", 409);
    }
    throw error;
  }
}

async function lockHistory(client: Prisma.TransactionClient, id: string) {
  const project = await client.playground.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  await client.playground.update({ where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1)) } });
}

async function currentProjectContent(playgroundId: string, template: string, client: Pick<Prisma.TransactionClient, "templateFile"> = db) {
  const templateFile = await client.templateFile.findUnique({ where: { playgroundId } });
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

async function reserveSnapshot(client: Prisma.TransactionClient, id: string, content: unknown) {
  parseTemplateData(content);
  // Contend on the project row so simultaneous snapshot inserts cannot bypass the cap.
  await lockHistory(client, id);
  const count = await client.playgroundSnapshot.count({ where: { playgroundId: id } });
  if (count >= RESOURCE_LIMITS.snapshots) throw new AppError("SNAPSHOT_COUNT_LIMIT", "Project has reached 50 snapshots. Ask the owner to delete an unused snapshot before creating one or restoring history.", 409);
}

export async function listPlaygroundHistory(playgroundId: string) {
  return runPlaygroundAction("listHistory", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { role } = await requirePlaygroundAccess(id);
    const [snapshots, events, count, current] = await Promise.all([
      db.playgroundSnapshot.findMany({
        where: { playgroundId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RESOURCE_LIMITS.snapshots,
        select: { id: true, name: true, kind: true, templateVersion: true, createdById: true, createdByName: true, createdAt: true },
      }),
      db.playgroundHistoryEvent.findMany({ where: { playgroundId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
      db.playgroundSnapshot.count({ where: { playgroundId: id } }),
      db.templateFile.findUnique({ where: { playgroundId: id }, select: { version: true } }),
    ]);
    return { currentRole: role, snapshots, events, currentVersion: current?.version ?? 0,
      retention: { count, limit: RESOURCE_LIMITS.snapshots, remaining: Math.max(0, RESOURCE_LIMITS.snapshots - count), automaticDeletion: false } };
  });
}

export async function createPlaygroundSnapshot(playgroundId: string, name: unknown) {
  return runPlaygroundAction("createSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground, user } = await requirePlaygroundEditor(id);
    const snapshotName = snapshotNameSchema.parse(name);
    const snapshot = await historyTransaction(async transaction => {
      const current = await currentProjectContent(id, playground.template, transaction);
      await reserveSnapshot(transaction, id, current.content);
      const created = await transaction.playgroundSnapshot.create({
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
      await transaction.playgroundHistoryEvent.create({ data: {
        playgroundId: id, type: "SNAPSHOT_CREATED", actorId: user.id, actorName: actorName(user), snapshotId: created.id, snapshotName: created.name, snapshotVersion: current.version,
      } });
      return created;
    });
    revalidatePath(`/playground/${id}`);
    return snapshot;
  });
}

export async function restorePlaygroundSnapshot(playgroundId: string, snapshotId: unknown, expectedVersion?: number) {
  return runPlaygroundAction("restoreSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground, user } = await requirePlaygroundEditor(id);
    const parsedSnapshotId = snapshotIdSchema.parse(snapshotId);
    const version = expectedVersionSchema.parse(expectedVersion);
    const result = await historyTransaction(async transaction => {
      // Read the target inside the same transaction as deletion/retention/restore.
      const snapshot = await transaction.playgroundSnapshot.findFirst({ where: { id: parsedSnapshotId, playgroundId: id } });
      if (!snapshot) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found", 404);
      parseTemplateData(snapshot.content);
      const current = await currentProjectContent(id, playground.template, transaction);
      if (version !== undefined && current.version !== version) throw new AppError("SAVE_CONFLICT", "The saved project changed since history was opened. Refresh history before restoring.", 409);
      await reserveSnapshot(transaction, id, current.content);
      const restoredProject = await transaction.playground.update({ where: { id }, data: { collaborationRevision: { increment: 1 } } });
      const restorePoint = await transaction.playgroundSnapshot.create({ data: {
        playgroundId: id,
        name: `Before restoring ${snapshot.name}`.slice(0, 80),
        kind: "RESTORE_POINT",
        content: current.content,
        templateVersion: current.version,
        createdById: user.id,
        createdByName: actorName(user),
      } });
      const restored = await transaction.templateFile.upsert({
        where: { playgroundId: id },
        update: { content: inputJson(snapshot.content), version: { increment: 1 } },
        create: { playgroundId: id, content: inputJson(snapshot.content), version: 1 },
      });
      await transaction.collaborationDocument.deleteMany({ where: { playgroundId: id, filePath: { not: PROJECT_NOTES_PATH } } });
      await transaction.playgroundHistoryEvent.create({ data: {
        playgroundId: id, type: "SNAPSHOT_RESTORED", actorId: user.id, actorName: actorName(user), snapshotId: snapshot.id, snapshotName: snapshot.name,
        snapshotVersion: snapshot.templateVersion, previousVersion: current.version, resultingVersion: restored.version,
        restorePointId: restorePoint.id, restorePointName: restorePoint.name, collaborationRevision: restoredProject.collaborationRevision,
      } });
      return { snapshotId: snapshot.id, name: snapshot.name, restorePointId: restorePoint.id, version: restored.version };
    });
    revalidatePath(`/playground/${id}`);
    return result;
  });
}

export async function deletePlaygroundSnapshot(playgroundId: string, snapshotId: unknown) {
  return runPlaygroundAction("deleteSnapshot", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { user } = await requirePlaygroundOwner(id);
    const parsedSnapshotId = snapshotIdSchema.parse(snapshotId);
    await historyTransaction(async transaction => {
      const snapshot = await transaction.playgroundSnapshot.findFirst({ where: { id: parsedSnapshotId, playgroundId: id } });
      if (!snapshot) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found", 404);
      await lockHistory(transaction, id);
      const deleted = await transaction.playgroundSnapshot.deleteMany({ where: { id: parsedSnapshotId, playgroundId: id } });
      if (deleted.count !== 1) throw new AppError("HISTORY_CONFLICT", "Snapshot changed in another session. Refresh history and try again.", 409);
      await transaction.playgroundHistoryEvent.create({ data: {
        playgroundId: id, type: "SNAPSHOT_DELETED", actorId: user.id, actorName: actorName(user), snapshotId: snapshot.id, snapshotName: snapshot.name, snapshotVersion: snapshot.templateVersion,
      } });
    });
    revalidatePath(`/playground/${id}`);
    return { id: parsedSnapshotId };
  });
}

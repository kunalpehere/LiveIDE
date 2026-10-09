"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { TemplateFolder } from "../libs/path-to-json";
import {
  requireCurrentUser,
  requirePlaygroundAccess,
  requirePlaygroundEditor,
  requirePlaygroundOwner,
} from "../lib/authorization";
import {
  createPlaygroundSchema,
  editPlaygroundSchema,
  parseTemplateData,
  playgroundIdSchema,
} from "../lib/validation";
import { runPlaygroundAction } from "../lib/action-result";

export const toggleStarMarked = async (playgroundId: string, isChecked: boolean) => {
 return runPlaygroundAction("toggleStar", async () => {
  const id = playgroundIdSchema.parse(playgroundId);
  const { user } = await requirePlaygroundAccess(id);

  if (isChecked) {
    await db.starMark.upsert({
      where: { userId_playgroundId: { userId: user.id, playgroundId: id } },
      update: { isMarked: true },
      create: { userId: user.id, playgroundId: id, isMarked: true },
    });
  } else {
    await db.starMark.deleteMany({
      where: { userId: user.id, playgroundId: id },
    });
  }

  revalidatePath("/dashboard");
  return { isMarked: isChecked };
 });
};

export const createPlayground = async (input: unknown) => {
 return runPlaygroundAction("createPlayground", async () => {
  const user = await requireCurrentUser();
  const data = createPlaygroundSchema.parse(input);

  const playground = await db.playground.create({
    data: {
      title: data.title,
      description: data.description,
      template: data.template,
      userId: user.id,
    },
  });

  revalidatePath("/dashboard");
  return playground;
 });
};

export const getAllPlaygroundForUser = async () => {
  const user = await requireCurrentUser();

  return db.playground.findMany({
    where: {
      OR: [
        { userId: user.id },
        { members: { some: { userId: user.id } } },
      ],
    },
    include: {
      user: true,
      Starmark: {
        where: { userId: user.id },
        select: { isMarked: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
};

export const getPlaygroundById = async (playgroundId: string) => {
  const id = playgroundIdSchema.parse(playgroundId);
  const { role } = await requirePlaygroundAccess(id);

  const playground = await db.playground.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      template: true,
      githubSource: true,
      templateFiles: { select: { content: true, version: true } },
    },
  });
  return playground ? { ...playground, githubImported: !!playground.githubSource, accessRole: role } : null;
};

export const SaveUpdatedCode = async (
  playgroundId: string,
  input: TemplateFolder,
  expectedVersion?: number,
) => {
 return runPlaygroundAction("saveCode", async () => {
  const id = playgroundIdSchema.parse(playgroundId);
  await requirePlaygroundEditor(id);
  const data = parseTemplateData(input);
  const content = data as unknown as Prisma.InputJsonValue;

  if (expectedVersion !== undefined) {
    const result = await db.templateFile.updateMany({
      where: { playgroundId: id, version: expectedVersion },
      data: { content, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.templateFile.findUnique({ where: { playgroundId: id } });
      if (existing) {
        throw new AppError("SAVE_CONFLICT", "This playground was updated in another session. Reload before saving.", 409);
      }
    } else {
      return db.templateFile.findUniqueOrThrow({ where: { playgroundId: id } });
    }
  }

  return db.templateFile.upsert({
    where: { playgroundId: id },
    update: { content, version: { increment: 1 } },
    create: { playgroundId: id, content, version: 1 },
  });
 });
};

export const deleteProjectById = async (playgroundId: string) => {
 return runPlaygroundAction("deleteProject", async () => {
  const id = playgroundIdSchema.parse(playgroundId);
  const { user } = await requirePlaygroundOwner(id);
  await db.$transaction(async tx => {
    const available = await tx.playground.updateMany({ where: { id, userId: user.id, OR: [{ githubCommitLock: null }, { githubCommitLock: { isSet: false } }] }, data: { githubCommitLock: "deleting" } });
    if (available.count !== 1) throw new AppError("PENDING_COMMIT", "Recover or abandon the pending GitHub commit before deleting this project.", 409);
    await tx.playground.delete({ where: { id } });
  });
  revalidatePath("/dashboard");
  return { id };
 });
};

export const editProjectById = async (playgroundId: string, input: unknown) => {
 return runPlaygroundAction("editProject", async () => {
  const id = playgroundIdSchema.parse(playgroundId);
  await requirePlaygroundEditor(id);
  const data = editPlaygroundSchema.parse(input);

  const playground = await db.playground.update({ where: { id }, data });
  revalidatePath("/dashboard");
  return playground;
 });
};

export const duplicateProjectById = async (playgroundId: string) => {
 return runPlaygroundAction("duplicateProject", async () => {
  const id = playgroundIdSchema.parse(playgroundId);
  const { user } = await requirePlaygroundAccess(id);

  const original = await db.playground.findUnique({
    where: { id },
    include: { templateFiles: true },
  });

  if (!original) {
    throw new Error("Playground not found");
  }

  for (const file of original.templateFiles) parseTemplateData(file.content);

  const duplicate = await db.playground.create({
    data: {
      title: `${original.title} (Copy)`,
      description: original.description,
      template: original.template,
      userId: user.id,
      templateFiles: {
        create: original.templateFiles.map((file) => ({
          content: file.content as Prisma.InputJsonValue,
        })),
      },
    },
  });

  revalidatePath("/dashboard");
  return duplicate;
 });
};

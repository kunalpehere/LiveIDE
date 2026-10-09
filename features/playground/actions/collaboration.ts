"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { playgroundIdSchema } from "../lib/validation";
import { requirePlaygroundAccess, requirePlaygroundOwner } from "../lib/authorization";
import { runPlaygroundAction } from "../lib/action-result";

const collaboratorSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["EDITOR", "VIEWER"]),
});
const membershipIdSchema = z.string().trim().min(1).max(128);

export async function listPlaygroundCollaborators(playgroundId: string) {
  return runPlaygroundAction("listCollaborators", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground, role } = await requirePlaygroundAccess(id);
    const [owner, members] = await Promise.all([
      db.user.findUnique({ where: { id: playground.userId }, select: { id: true, name: true, email: true, image: true } }),
      db.playgroundMember.findMany({
        where: { playgroundId: id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      }),
    ]);
    return { currentRole: role, owner, members };
  });
}

export async function invitePlaygroundCollaborator(playgroundId: string, input: unknown) {
  return runPlaygroundAction("inviteCollaborator", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { playground } = await requirePlaygroundOwner(id);
    const data = collaboratorSchema.parse(input);
    const invitedUser = await db.user.findUnique({ where: { email: data.email } });
    if (!invitedUser) throw new AppError("USER_NOT_FOUND", "No LiveIDE user exists with that email address", 404);
    if (invitedUser.id === playground.userId) throw new AppError("OWNER_MEMBERSHIP", "The project owner cannot be added as a collaborator", 400);
    const member = await db.playgroundMember.upsert({
      where: { playgroundId_userId: { playgroundId: id, userId: invitedUser.id } },
      update: { role: data.role },
      create: { playgroundId: id, userId: invitedUser.id, role: data.role },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });
    revalidatePath(`/playground/${id}`);
    return member;
  });
}

export async function updatePlaygroundCollaborator(playgroundId: string, membershipId: string, role: unknown) {
  return runPlaygroundAction("updateCollaborator", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    await requirePlaygroundOwner(id);
    const memberId = membershipIdSchema.parse(membershipId);
    const parsedRole = z.enum(["EDITOR", "VIEWER"]).parse(role);
    const existing = await db.playgroundMember.findFirst({ where: { id: memberId, playgroundId: id } });
    if (!existing) throw new AppError("MEMBER_NOT_FOUND", "Collaborator not found", 404);
    const member = await db.playgroundMember.update({ where: { id: memberId }, data: { role: parsedRole } });
    revalidatePath(`/playground/${id}`);
    return member;
  });
}

export async function removePlaygroundCollaborator(playgroundId: string, membershipId: string) {
  return runPlaygroundAction("removeCollaborator", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    await requirePlaygroundOwner(id);
    const memberId = membershipIdSchema.parse(membershipId);
    const result = await db.playgroundMember.deleteMany({ where: { id: memberId, playgroundId: id } });
    if (result.count === 0) throw new AppError("MEMBER_NOT_FOUND", "Collaborator not found", 404);
    revalidatePath(`/playground/${id}`);
    return { id: memberId };
  });
}

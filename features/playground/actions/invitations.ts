"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { playgroundIdSchema } from "../lib/validation";
import { requireCurrentUser, requirePlaygroundOwner } from "../lib/authorization";
import { runPlaygroundAction } from "../lib/action-result";
import { hashInvitationToken, invitationInputSchema, invitationState, invitationTokenSchema, newInvitationToken } from "../lib/invitations";

export async function createPlaygroundInvitation(playgroundId: string, input: unknown) {
  return runPlaygroundAction("createInvitation", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    const { user } = await requirePlaygroundOwner(id);
    const data = invitationInputSchema.parse(input);
    const token = newInvitationToken();
    const invitation = await db.playgroundInvitation.create({ data: {
      playgroundId: id, role: data.role, createdById: user.id,
      tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + data.expiryHours * 3_600_000),
      usedAt: null, usedById: null, revokedAt: null,
    } });
    // The plaintext token is returned once, never stored or included in listings.
    return { id: invitation.id, path: `/invitations/${token}`, expiresAt: invitation.expiresAt };
  });
}

export async function listPlaygroundInvitations(playgroundId: string) {
  return runPlaygroundAction("listInvitations", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    await requirePlaygroundOwner(id);
    const invitations = await db.playgroundInvitation.findMany({ where: { playgroundId: id }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, role: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } });
    return invitations.map(invitation => ({ ...invitation, state: invitationState(invitation) }));
  });
}

export async function revokePlaygroundInvitation(playgroundId: string, invitationId: string) {
  return runPlaygroundAction("revokeInvitation", async () => {
    const id = playgroundIdSchema.parse(playgroundId);
    await requirePlaygroundOwner(id);
    const key = z.string().min(1).max(128).parse(invitationId);
    const result = await db.playgroundInvitation.updateMany({ where: {
      id: key, playgroundId: id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
    }, data: { revokedAt: new Date() } });
    if (!result.count) throw new AppError("INVITATION_UNAVAILABLE", "This invitation is no longer pending", 409);
    return { id: key };
  });
}

export async function inspectPlaygroundInvitation(rawToken: string) {
  return runPlaygroundAction("inspectInvitation", async () => {
    await requireCurrentUser();
    const token = invitationTokenSchema.parse(rawToken);
    const invitation = await db.playgroundInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) }, include: { playground: true } });
    if (!invitation || !invitation.playground) throw new AppError("INVITATION_NOT_FOUND", "Invitation not found", 404);
    return { title: invitation.playground.title, role: invitation.role, expiresAt: invitation.expiresAt, state: invitationState(invitation) };
  });
}

export async function acceptPlaygroundInvitation(rawToken: string) {
  return runPlaygroundAction("acceptInvitation", async () => {
    const user = await requireCurrentUser();
    const token = invitationTokenSchema.parse(rawToken);
    // A conditional claim and membership write commit together. MongoDB write
    // conflicts roll back the whole transaction, including the claim.
    const accept = () => db.$transaction(async tx => {
      const invitation = await tx.playgroundInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) }, include: { playground: true } });
      if (!invitation || !invitation.playground) throw new AppError("INVITATION_NOT_FOUND", "Invitation not found", 404);
      const state = invitationState(invitation);
      if (state !== "PENDING") throw new AppError(`INVITATION_${state}`, `This invitation is ${state.toLowerCase()}`, 409);
      if (invitation.playground.userId === user.id) throw new AppError("OWNER_MEMBERSHIP", "You already own this project. Share this link with someone else.", 400);
      const claimed = await tx.playgroundInvitation.updateMany({ where: {
        id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
      }, data: { usedAt: new Date(), usedById: user.id } });
      if (claimed.count !== 1) throw new AppError("INVITATION_UNAVAILABLE", "This invitation is no longer available", 409);
      await tx.playgroundMember.upsert({ where: { playgroundId_userId: { playgroundId: invitation.playgroundId, userId: user.id } },
        create: { playgroundId: invitation.playgroundId, userId: user.id, role: invitation.role }, update: {} });
      return { playgroundId: invitation.playgroundId };
    });
    let result: { playgroundId: string } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { result = await accept(); break; }
      catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
        if (attempt === 2) throw new AppError("INVITATION_BUSY", "Another invitation operation is in progress. Please try again.", 409);
      }
    }
    if (!result) throw new AppError("INVITATION_BUSY", "Please try accepting this invitation again.", 409);
    revalidatePath("/dashboard");
    revalidatePath(`/playground/${result.playgroundId}`);
    return result;
  });
}

import "server-only";

import { currentUser } from "@/features/auth/actions";
import { db } from "@/lib/db";

export type PlaygroundAccessRole = "OWNER" | "EDITOR" | "VIEWER";
const roleRank: Record<PlaygroundAccessRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export class AuthenticationError extends Error {
  constructor(message = "You must be signed in to continue") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have access to this playground") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class PlaygroundNotFoundError extends Error {
  constructor(message = "Playground not found") {
    super(message);
    this.name = "PlaygroundNotFoundError";
  }
}

export async function requireCurrentUser() {
  const user = await currentUser();

  if (!user?.id) {
    throw new AuthenticationError();
  }

  return { ...user, id: user.id };
}

export async function requirePlaygroundAccess(
  playgroundId: string,
  minimumRole: PlaygroundAccessRole = "VIEWER",
) {
  const user = await requireCurrentUser();
  const playground = await db.playground.findUnique({
    where: { id: playgroundId },
  });

  if (!playground) {
    throw new PlaygroundNotFoundError();
  }

  let role: PlaygroundAccessRole | null = playground.userId === user.id ? "OWNER" : null;
  if (!role) {
    const membership = await db.playgroundMember.findUnique({
      where: { playgroundId_userId: { playgroundId, userId: user.id } },
    });
    role = membership?.role || null;
  }

  if (!role || roleRank[role] < roleRank[minimumRole]) {
    throw new AuthorizationError();
  }

  return { user, playground, role };
}

export function requirePlaygroundOwner(playgroundId: string) {
  return requirePlaygroundAccess(playgroundId, "OWNER");
}

export function requirePlaygroundEditor(playgroundId: string) {
  return requirePlaygroundAccess(playgroundId, "EDITOR");
}

export function getAuthorizationStatus(error: unknown) {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof AuthorizationError) return 403;
  if (error instanceof PlaygroundNotFoundError) return 404;
  return 500;
}

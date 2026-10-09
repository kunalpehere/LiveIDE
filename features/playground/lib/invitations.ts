import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const invitationInputSchema = z.object({
  role: z.enum(["EDITOR", "VIEWER"]),
  expiryHours: z.union([z.literal(1), z.literal(24), z.literal(168)]),
});
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation link");
export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function newInvitationToken() { return randomBytes(32).toString("base64url"); }
export function invitationState(invitation: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()) {
  if (invitation.usedAt) return "USED" as const;
  if (invitation.revokedAt) return "REVOKED" as const;
  if (invitation.expiresAt <= now) return "EXPIRED" as const;
  return "PENDING" as const;
}

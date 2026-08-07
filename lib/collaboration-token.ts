import { SignJWT, jwtVerify } from "jose";

export interface CollaborationClaims {
  playgroundId: string;
  room: string;
  filePath: string;
  revision: number;
  userId: string;
  name: string;
  color: string;
}

function signingKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createCollaborationToken(claims: CollaborationClaims, secret: string) {
  return new SignJWT({ ...claims, scope: "collaboration:write" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signingKey(secret));
}

export async function verifyCollaborationToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ["HS256"] });
  if (payload.scope !== "collaboration:write" || typeof payload.playgroundId !== "string" ||
      typeof payload.room !== "string" || typeof payload.filePath !== "string" || typeof payload.revision !== "number" || typeof payload.userId !== "string") {
    throw new Error("Invalid collaboration token");
  }
  return payload as unknown as CollaborationClaims;
}

export function collaborationRoom(playgroundId: string, filePath: string, revision = 1) {
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
  return `${playgroundId}.r${revision}.${encodedPath}`;
}

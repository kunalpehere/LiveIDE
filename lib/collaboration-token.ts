import { SignJWT, jwtVerify } from "jose";
import { PROTOCOL_VERSION, parseClaims } from "./collaboration-protocol.mjs";
import type { CollaborationClaims as WireClaims } from "./collaboration-protocol";
export { collaborationRoom } from "./collaboration-protocol.mjs";

export type CollaborationClaims = Omit<WireClaims, "scope" | "iat" | "exp" | "protocolVersion">;

function signingKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createCollaborationToken(claims: CollaborationClaims, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = parseClaims({ ...claims, scope: claims.role === "VIEWER" ? "collaboration:read" : "collaboration:write", protocolVersion: PROTOCOL_VERSION, iat: now, exp: now + 600 });
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signingKey(secret));
}

export async function verifyCollaborationToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ["HS256"] });
  return parseClaims(payload);
}

import { timingSafeEqual } from "node:crypto";
import { getCollaborationConfiguration } from "./runtime-config.mjs";
import { CollaborationProtocolError } from "./collaboration-protocol.mjs";

export function requireCollaborationService(request: Request) {
  const { secret } = getCollaborationConfiguration();
  const received = request.headers.get("x-collaboration-secret");
  const left = Buffer.from(received || ""); const right = Buffer.from(secret || "");
  if (!secret || !received || left.length !== right.length || !timingSafeEqual(left, right)) throw new CollaborationProtocolError("UNAUTHORIZED");
  return secret;
}

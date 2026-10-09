import { randomUUID } from "node:crypto";
import { accessResponseSchema, assertRoom, CollaborationProtocolError } from "../lib/collaboration-protocol.mjs";

export function createSessionAccess({ claims, token, secret, appUrl, testMode }) {
  let pending;
  const assertValid = () => { if (Date.now() >= claims.exp * 1000) throw new CollaborationProtocolError("UNAUTHORIZED"); };
  async function check() {
    assertValid();
    if (testMode) return;
    if (!pending) pending = (async () => {
      const response = await fetch(new URL("/api/collaboration/access", appUrl), { method: "POST", redirect: "error",
        headers: { "x-collaboration-secret": secret, authorization: `Bearer ${token}`, "x-request-id": randomUUID() }, signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new CollaborationProtocolError(response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : response.status === 409 ? "ROOM_MISMATCH" : "UNAVAILABLE");
      const result = accessResponseSchema.parse(await response.json()); assertRoom(result.data);
      for (const field of ["playgroundId", "filePath", "room", "revision", "role"]) if (result.data[field] !== claims[field]) throw new CollaborationProtocolError("FORBIDDEN");
      assertValid();
    })().finally(() => { pending = undefined; });
    try { await pending; } catch (error) { throw error instanceof CollaborationProtocolError ? error : new CollaborationProtocolError("UNAVAILABLE"); }
  }
  function watch(socket) {
    let closed = false;
    let poll;
    const fail = error => socket.close(error.code === "UNAUTHORIZED" && Date.now() >= claims.exp * 1000 ? 4001 : error.code === "ROOM_MISMATCH" ? 4009 : error.code === "UNAVAILABLE" ? 1013 : 4003, error.code);
    const expiry = setTimeout(() => { if (!closed) socket.close(4001, "UNAUTHORIZED"); }, Math.max(0, claims.exp * 1000 - Date.now()));
    const tick = async () => {
      try { await check(); } catch (error) { if (!closed) fail(error); return; }
      if (!closed) poll = setTimeout(tick, 5000);
    };
    poll = setTimeout(tick, 5000);
    socket.once("close", () => { closed = true; clearTimeout(poll); clearTimeout(expiry); });
  }
  return { check, assertValid, watch };
}

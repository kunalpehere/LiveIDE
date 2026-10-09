import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { SignJWT } from "jose";
import { collaborationRoom, PROTOCOL_VERSION, encodeFrame, decodeFrame, parseClaims, parseRelayMessage, snapshotSaveSchema, sessionSchema, tokenRequestSchema, errorResponseSchema, protocolErrorResponse } from "@/lib/collaboration-protocol.mjs";
import { verifyCollaborationToken } from "@/lib/collaboration-token";
import { configureYjsValidation } from "@/lib/collaboration-protocol.mjs";
configureYjsValidation(Y.decodeUpdate);

const identity = { protocolVersion: PROTOCOL_VERSION, playgroundId: "project-1", filePath: "src/App.tsx", revision: 1, room: collaborationRoom("project-1", "src/App.tsx", 1), role: "EDITOR" as const };
const claims = { ...identity, scope: "collaboration:write", userId: "user-1", name: "Editor", color: "#3b82f6", iat: 1, exp: 601 };
function sync(subtype: number, bytes: Uint8Array) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); encoding.writeVarUint(encoder, subtype); encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
}

describe("versioned collaboration contracts", () => {
  it("round-trips state vectors and update frames without changing Yjs bytes", () => {
    const doc = new Y.Doc(); doc.getText("content").insert(0, "hello");
    try {
      for (const raw of [sync(0, Y.encodeStateVector(doc)), sync(1, Y.encodeStateAsUpdate(doc)), sync(2, Y.encodeStateAsUpdate(doc))]) {
        const decoded = decodeFrame(encodeFrame(raw));
        expect(decoded.type).toBe("sync"); expect(decoded.protocolVersion).toBe(1); expect(decoded.payload).toEqual(raw);
      }
    } finally { doc.destroy(); }
  });
  it("accepts genuine awareness and rejects invalid nested awareness payloads", () => {
    const doc = new Y.Doc(); const awareness = new Awareness(doc);
    try {
      awareness.setLocalState({ user: { name: "One" } });
      const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [doc.clientID]));
      expect(decodeFrame(encodeFrame(encoding.toUint8Array(encoder))).type).toBe("awareness");
      expect(() => decodeFrame(new Uint8Array([76, 73, 68, 69, 1, 1, 1, 255]))).toThrow("invalid collaboration");
    } finally { awareness.destroy(); doc.destroy(); }
  });
  it("rejects unsupported versions, legacy, unknown, truncated and trailing-byte frames", () => {
    const doc = new Y.Doc();
    const raw = sync(0, Y.encodeStateVector(doc));
    const valid = encodeFrame(raw); doc.destroy();
    const wrongVersion = valid.slice(); wrongVersion[4] = 2;
    expect(() => decodeFrame(wrongVersion)).toThrow("versions differ");
    for (const invalid of [raw, "hello", valid.slice(0, -1), new Uint8Array([...valid, 0]), new Uint8Array([76,73,68,69,1,99]), new Uint8Array([76,73,68,69,1,0,2,1,255])]) expect(() => decodeFrame(invalid)).toThrow();
  });
  it("validates positive integer revisions, bounded identifiers and relative file paths", () => {
    expect(sessionSchema.safeParse(identity).success).toBe(true);
    for (const revision of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(sessionSchema.safeParse({ ...identity, revision }).success).toBe(false);
    for (const filePath of ["../secret", "/src/App.tsx", "src//App.tsx", "src\\App.tsx", "src/./App.tsx", "\u0000"])
      expect(tokenRequestSchema.safeParse({ protocolVersion: 1, playgroundId: "project-1", filePath }).success).toBe(false);
    expect(tokenRequestSchema.safeParse({ protocolVersion: 2, playgroundId: "project-1", filePath: "src/App.tsx" }).success).toBe(false);
    expect(snapshotSaveSchema.safeParse({ ...identity, state: "not base64" }).success).toBe(false);
  });
  it("binds signed roles, room identity and revision rather than trusting a URL", () => {
    expect(parseClaims(claims).role).toBe("EDITOR");
    expect(() => parseClaims({ ...claims, role: "VIEWER" })).toThrow("role cannot edit");
    expect(() => parseClaims({ ...claims, revision: 2 })).toThrow("room does not match");
    expect(() => parseClaims({ ...claims, role: "ADMIN" })).toThrow();
    expect(() => parseClaims({ ...claims, protocolVersion: undefined })).toThrow("versions differ");
    expect(collaborationRoom("project-1", "src/你好.tsx", 2)).toBe(`project-1.r2.${Buffer.from("src/你好.tsx").toString("base64url")}`);
  });
  it("rejects a correctly signed but incompatible token", async () => {
    const secret = "contract-test-secret";
    const token = await new SignJWT({ ...claims, protocolVersion: 2 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2m").sign(new TextEncoder().encode(secret));
    await expect(verifyCollaborationToken(token, secret)).rejects.toThrow("versions differ");
  });
  it("checks relay versions and Yjs payloads and exposes fixed error contracts", () => {
    const relay = { ...identity, instanceId: "one", type: "update", data: "AAA=" };
    expect(parseRelayMessage(relay).room).toBe(identity.room);
    expect(() => parseRelayMessage({ ...relay, data: "AQID" })).toThrow();
    expect(() => parseRelayMessage({ ...relay, protocolVersion: 9 })).toThrow("versions differ");
    expect(errorResponseSchema.safeParse(protocolErrorResponse("VERSION_MISMATCH")).success).toBe(true);
  });
});

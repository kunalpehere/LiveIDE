import { z } from "zod";
import * as decoding from "lib0/decoding";

export const PROTOCOL_VERSION = 1;
// Reserved ephemeral project channel; never hydrated or checkpointed as a file.
export const PROJECT_PRESENCE_PATH = ".liveide/presence";
export const PROJECT_RUNTIME_PATH = ".liveide/runtime";
/** @param {string} filePath */
export function ephemeralDocument(filePath) { return filePath === PROJECT_PRESENCE_PATH || filePath === PROJECT_RUNTIME_PATH; }
// Persistent project document, independent of source snapshot revisions.
export const PROJECT_NOTES_PATH = ".liveide/notes";
/** @param {number} sourceRevision @param {string} filePath */
export function documentRevision(sourceRevision, filePath) { return filePath === PROJECT_NOTES_PATH ? 1 : sourceRevision; }
export const WEBSOCKET_PROTOCOL = "liveide.collaboration.v1";
export const MAX_FRAME_BYTES = 1024 * 1024;
const magic = new Uint8Array([76, 73, 68, 69]); // LIDE
/** @type {((bytes: Uint8Array) => unknown) | null} */
let updateValidator = null;
// The browser uses ESM Yjs; the legacy server uses CommonJS Yjs. Inject that
// runtime's existing decoder instead of loading a second Yjs implementation.
/** @param {(bytes: Uint8Array) => unknown} decodeUpdate */
export function configureYjsValidation(decodeUpdate) { updateValidator = decodeUpdate; }
/** @param {Uint8Array} bytes */
function validateUpdate(bytes) {
  if (!updateValidator) throw new Error("Yjs validation has not been initialized");
  updateValidator(bytes);
}

export const protocolErrorCodes = ["VERSION_MISMATCH", "MALFORMED_MESSAGE", "ROOM_MISMATCH", "FORBIDDEN", "UNAUTHORIZED", "UNAVAILABLE"];
const messages = {
  VERSION_MISMATCH: "Collaboration versions differ. Reload LiveIDE and try again.",
  MALFORMED_MESSAGE: "An invalid collaboration message was rejected.",
  ROOM_MISMATCH: "The collaboration room does not match this project revision and file.",
  FORBIDDEN: "This role cannot edit the collaboration document.",
  UNAUTHORIZED: "Collaboration authorization failed. Sign in and try again.",
  UNAVAILABLE: "The collaboration service is temporarily unavailable.",
};
/** @typedef {keyof typeof messages} ProtocolErrorCode */
export class CollaborationProtocolError extends Error {
  /** @param {ProtocolErrorCode} code */
  constructor(code) { super(messages[code]); this.name = "CollaborationProtocolError"; this.code = code; }
}

export const filePathSchema = z.string().min(1).max(1024).refine(path =>
  !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."), "Expected a relative file path");
export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export const identitySchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  playgroundId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  filePath: filePathSchema, revision: z.number().int().positive().safe(), room: z.string().min(1).max(6000),
});
export const sessionSchema = identitySchema.extend({ role: roleSchema }).strict();
export const tokenRequestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), playgroundId: identitySchema.shape.playgroundId, filePath: filePathSchema }).strict();
export const claimsSchema = sessionSchema.extend({ scope: z.enum(["collaboration:read", "collaboration:write"]), userId: z.string().min(1).max(128),
  name: z.string().min(1).max(320), color: z.string().regex(/^#[0-9a-f]{6}$/i), iat: z.number().int(), exp: z.number().int(),
}).strict();
export const tokenResponseSchema = z.object({ success: z.literal(true), data: sessionSchema.extend({
  websocketUrl: z.string().url().refine(value => ["ws:", "wss:"].includes(new URL(value).protocol)), token: z.string().min(1).max(8192),
  user: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(320), color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
}).strict() }).strict();
export const errorResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), error: z.object({
  code: z.enum(["VERSION_MISMATCH", "MALFORMED_MESSAGE", "ROOM_MISMATCH", "FORBIDDEN", "UNAUTHORIZED", "UNAVAILABLE"]), message: z.string().max(200),
}).strict() }).strict();
export const base64Schema = z.string().min(4).max(3_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const snapshotQuerySchema = identitySchema.strict();
export const snapshotSaveSchema = identitySchema.extend({ state: base64Schema }).strict();
export const snapshotResponseSchema = z.object({ success: z.literal(true), data: identitySchema.extend({
  state: base64Schema.optional(), content: z.string().optional(),
}).strict().refine(data => (data.state !== undefined) !== (data.content !== undefined), "Expected state or content") }).strict();
export const snapshotAckSchema = z.object({ success: z.literal(true), protocolVersion: z.literal(PROTOCOL_VERSION) }).strict();
export const accessResponseSchema = z.object({ success: z.literal(true), data: sessionSchema }).strict();
export const relayMessageSchema = sessionSchema.extend({ type: z.enum(["update", "awareness"]), data: base64Schema,
  instanceId: z.string().min(1).max(128),
}).strict();

/** @param {string} playgroundId @param {string} filePath @param {number} [revision] */
export function collaborationRoom(playgroundId, filePath, revision = 1) {
  const bytes = new TextEncoder().encode(filePath);
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${playgroundId}.r${revision}.${encoded}`;
}
/** @param {unknown} value */
export function requireProtocolVersion(value) {
  if (!value || typeof value !== "object" || !("protocolVersion" in value) || value.protocolVersion !== PROTOCOL_VERSION) throw new CollaborationProtocolError("VERSION_MISMATCH");
}
/** @param {{playgroundId: string, filePath: string, revision: number, room: string}} identity */
export function assertRoom(identity) {
  if (identity.room !== collaborationRoom(identity.playgroundId, identity.filePath, identity.revision)) throw new CollaborationProtocolError("ROOM_MISMATCH");
}
/** @param {unknown} value */
export function parseClaims(value) {
  requireProtocolVersion(value);
  const parsed = claimsSchema.safeParse(value);
  if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  assertRoom(parsed.data);
  if (parsed.data.scope !== (parsed.data.role === "VIEWER" ? "collaboration:read" : "collaboration:write")) throw new CollaborationProtocolError("FORBIDDEN");
  if (parsed.data.exp <= parsed.data.iat || parsed.data.exp - parsed.data.iat > 600 || parsed.data.iat > Math.floor(Date.now() / 1000) + 5) throw new CollaborationProtocolError("UNAUTHORIZED");
  return parsed.data;
}
/** @param {ProtocolErrorCode} code */
export function protocolErrorResponse(code) { return { protocolVersion: PROTOCOL_VERSION, error: { code, message: messages[code] } }; }
/** @param {unknown} value */
export function parseTokenResponse(value) {
  if (!value || typeof value !== "object" || !("data" in value)) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  requireProtocolVersion(value.data);
  const parsed = tokenResponseSchema.safeParse(value);
  if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  assertRoom(parsed.data.data);
  return parsed.data;
}

/** @param {Uint8Array} payload */
function validateAwareness(payload) {
  const decoder = decoding.createDecoder(payload);
  const count = decoding.readVarUint(decoder);
  if (count > 10000) throw new Error("Invalid awareness count");
  for (let index = 0; index < count; index++) {
    decoding.readVarUint(decoder); decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));
    if (state !== null && (typeof state !== "object" || Array.isArray(state))) throw new Error("Invalid awareness state");
  }
  if (decoder.pos !== payload.length) throw new Error("Trailing awareness bytes");
}

/** @param {Uint8Array} raw
 * @returns {{protocolVersion: 1, type: "sync", subtype: 0 | 1 | 2, payload: Uint8Array} | {protocolVersion: 1, type: "awareness" | "query-awareness", payload: Uint8Array}}
 */
export function validateYjsMessage(raw) {
  try {
    if (raw.length === 0 || raw.length > MAX_FRAME_BYTES - 5) throw new Error("Invalid size");
    const decoder = decoding.createDecoder(raw);
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const subtype = decoding.readVarUint(decoder);
      if (subtype !== 0 && subtype !== 1 && subtype !== 2) throw new Error("Unknown sync message");
      const payload = decoding.readVarUint8Array(decoder);
      if (subtype === 0) {
        const vector = decoding.createDecoder(payload);
        const entries = decoding.readVarUint(vector);
        for (let index = 0; index < entries; index++) { decoding.readVarUint(vector); decoding.readVarUint(vector); }
        if (vector.pos !== payload.length) throw new Error("Trailing state vector bytes");
      } else validateUpdate(payload);
      if (decoder.pos !== raw.length) throw new Error("Trailing bytes");
      return { protocolVersion: PROTOCOL_VERSION, type: "sync", subtype, payload: raw };
    }
    if (type === 1) {
      validateAwareness(decoding.readVarUint8Array(decoder));
      if (decoder.pos !== raw.length) throw new Error("Trailing bytes");
      return { protocolVersion: PROTOCOL_VERSION, type: "awareness", payload: raw };
    }
    // y-websocket may query awareness; the installed server does not implement
    // this optional request, but it remains a valid, empty protocol message.
    if (type === 3 && decoder.pos === raw.length) return { protocolVersion: PROTOCOL_VERSION, type: "query-awareness", payload: raw };
    throw new Error("Unknown message");
  } catch { throw new CollaborationProtocolError("MALFORMED_MESSAGE"); }
}
/** @param {Uint8Array} raw */
export function encodeFrame(raw) {
  validateYjsMessage(raw);
  const frame = new Uint8Array(raw.length + 5);
  frame.set(magic); frame[4] = PROTOCOL_VERSION; frame.set(raw, 5);
  return frame;
}
/** @param {unknown} data */
export function decodeFrame(data) {
  const frame = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
  if (!frame || frame.length < 6 || frame.length > MAX_FRAME_BYTES || !magic.every((byte, index) => frame[index] === byte)) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  if (frame[4] !== PROTOCOL_VERSION) throw new CollaborationProtocolError("VERSION_MISMATCH");
  return validateYjsMessage(frame.subarray(5));
}

/** @param {unknown} value */
export function parseRelayMessage(value) {
  requireProtocolVersion(value);
  const parsed = relayMessageSchema.safeParse(value);
  if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
  assertRoom(parsed.data);
    if ((parsed.data.role === "VIEWER" || ephemeralDocument(parsed.data.filePath)) && parsed.data.type === "update") throw new CollaborationProtocolError("FORBIDDEN");
  const data = Uint8Array.from(atob(parsed.data.data), character => character.charCodeAt(0));
  try { if (parsed.data.type === "update") validateUpdate(data); else validateAwareness(data); }
  catch { throw new CollaborationProtocolError("MALFORMED_MESSAGE"); }
  return parsed.data;
}

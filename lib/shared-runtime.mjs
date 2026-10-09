import { z } from "zod";
import * as decoding from "lib0/decoding";
import { CollaborationProtocolError, PROJECT_RUNTIME_PATH } from "./collaboration-protocol.mjs";

export const RUNTIME_LOG_LIMIT = 40;
export const RUNTIME_PUBLISH_INTERVAL = 500;
export const runtimeOperationSchema = z.enum(["start", "stop", "restart"]);
export const runtimePhaseSchema = z.enum(["idle", "booting", "mounting", "installing", "starting", "ready", "stopped", "unsupported", "failed"]);
export const runtimeEventSchema = z.enum(["install", "ready", "warning", "error", "output"]);
export const runtimeLogSchema = z.object({ sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), event: runtimeEventSchema }).strict();
export const runtimeRequestSchema = z.object({ requestId: z.string().uuid(), token: z.string().min(1).max(4096), targetClientId: z.number().int().nonnegative(), targetNonce: z.string().uuid() }).strict();
export const runtimePresenceSchema = z.object({
  user: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(320), color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
  activeFile: z.literal(PROJECT_RUNTIME_PATH).optional(),
  runtime: z.object({ nonce: z.string().uuid(), phase: runtimePhaseSchema, previewReady: z.boolean(), controls: z.boolean(), logs: z.array(runtimeLogSchema).max(RUNTIME_LOG_LIMIT) }).strict(),
  request: runtimeRequestSchema.nullable(),
  ack: z.object({ requestId: z.string().uuid(), outcome: z.enum(["accepted", "completed", "rejected", "failed"]) }).strict().nullable(),
}).strict();
export const runtimeControlInputSchema = z.object({ playgroundId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), targetUserId: z.string().min(1).max(128), targetClientId: z.number().int().nonnegative(), targetNonce: z.string().uuid(), operation: runtimeOperationSchema, revision: z.number().int().positive() }).strict();
export const runtimeCommandSchema = runtimeControlInputSchema.extend({ requestId: z.string().uuid(), requesterId: z.string().min(1).max(128), scope: z.literal("runtime:control"), iat: z.number().int(), exp: z.number().int() }).strict();
export const runtimeEventLabels = { install: "Dependency installation activity", ready: "Development server reported readiness", warning: "Process reported a warning", error: "Process reported an error", output: "Runtime process produced output" };
/** @param {string} operation @param {string} phase */
export function runtimeOperationAllowed(operation, phase) {
  if (operation === "start") return ["idle", "stopped", "failed"].includes(phase);
  if (operation === "stop") return ["booting", "mounting", "installing", "starting", "ready"].includes(phase);
  return operation === "restart" && phase === "ready";
}

/** Output is deliberately projected into fixed categories. No free-form text,
 * URLs, arguments, names, environment values, or terminal escapes leave the tab.
 * @param {string} raw
 * @returns {"error" | "warning" | "ready" | "install" | "output"} */
export function classifyRuntimeOutput(raw) {
  const sample = raw.slice(0, 4096).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (/\b(error|failed|fatal)\b/i.test(sample)) return "error";
  if (/\b(warn|warning)\b/i.test(sample)) return "warning";
  if (/\b(ready|listening)\b/i.test(sample)) return "ready";
  if (/\b(added|installing|packages|dependencies)\b/i.test(sample)) return "install";
  return "output";
}
/** @param {{userId: string, name: string, color: string, role: string}} claims
 * @param {(id: number) => boolean} isOwnedElsewhere */
export function createRuntimePresenceValidator(claims, isOwnedElsewhere) {
  /** @type {number | undefined} */ let owned;
  /** @param {Uint8Array} raw */
  return raw => {
    const message = decoding.createDecoder(raw);
    if (decoding.readVarUint(message) !== 1) return;
    const payload = decoding.createDecoder(decoding.readVarUint8Array(message));
    if (decoding.readVarUint(payload) !== 1) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
    const id = decoding.readVarUint(payload); decoding.readVarUint(payload);
    const state = JSON.parse(decoding.readVarString(payload));
    if ((owned !== undefined && owned !== id) || isOwnedElsewhere(id)) throw new CollaborationProtocolError("FORBIDDEN");
    if (state !== null) {
      const parsed = runtimePresenceSchema.safeParse(state);
      if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
      const { user, runtime, request, ack } = parsed.data;
      if (user.id !== claims.userId || user.name !== claims.name || user.color !== claims.color) throw new CollaborationProtocolError("FORBIDDEN");
      if (claims.role === "VIEWER" && (request || ack || runtime.controls || runtime.previewReady || runtime.logs.length || runtime.phase !== "idle")) throw new CollaborationProtocolError("FORBIDDEN");
    }
    owned = id;
  };
}

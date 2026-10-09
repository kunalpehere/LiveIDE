import { expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import { classifyRuntimeOutput, createRuntimePresenceValidator, runtimeEventLabels, runtimePresenceSchema, RUNTIME_LOG_LIMIT } from "@/lib/shared-runtime.mjs";
const user = { id: "user", name: "Owner", color: "#112233" };
const state = () => ({ user, activeFile: ".liveide/runtime" as const, runtime: { nonce: crypto.randomUUID(), phase: "ready" as const, previewReady: true, controls: false, logs: [] }, request: null, ack: null });
function frame(value: unknown) {
  const doc = new Y.Doc(), awareness = new Awareness(doc); awareness.setLocalState(value as Record<string, unknown>);
  const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 1); encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [doc.clientID]));
  const bytes = encoding.toUint8Array(encoder); awareness.destroy(); doc.destroy(); return bytes;
}
it("projects all output into fixed labels without exposing credentials, URLs, environment values, or terminal escapes", () => {
  for (const raw of ["TOKEN=secret-token", "mongodb://user:password@host/db", "ready https://host/?api_key=secret", "npm warn password: secret", "\x1b]52;c;c2VjcmV0\x07", "error: environment secret", "arbitrary unlabelled-secret"]) {
    const event = classifyRuntimeOutput(raw); const shared = JSON.stringify({ event, label: runtimeEventLabels[event] });
    expect(shared).not.toContain("secret"); expect(shared).not.toContain("password"); expect(shared).not.toContain("https://"); expect(shared).not.toContain("\x1b");
  }
});
it("rejects raw logs, oversized histories, unknown metadata, and non-finite values", () => {
  const base = state();
  expect(runtimePresenceSchema.safeParse(base).success).toBe(true);
  for (const runtime of [{ ...base.runtime, logs: [{ sequence: 1, event: "output", text: "secret" }] }, { ...base.runtime, logs: Array.from({ length: RUNTIME_LOG_LIMIT + 1 }, (_, sequence) => ({ sequence, event: "output" })) }, { ...base.runtime, env: { SECRET: "secret" } }, { ...base.runtime, logs: [{ sequence: Infinity, event: "error" }] }]) {
    expect(runtimePresenceSchema.safeParse({ ...base, runtime }).success).toBe(false);
  }
});
it("binds runtime announcements to authenticated identity and one owned awareness ID", () => {
  const claims = { userId: user.id, name: user.name, color: user.color, role: "EDITOR" };
  expect(() => createRuntimePresenceValidator(claims, () => false)(frame(state()))).not.toThrow();
  expect(() => createRuntimePresenceValidator(claims, () => false)(frame({ ...state(), user: { ...user, id: "other" } }))).toThrow();
  expect(() => createRuntimePresenceValidator(claims, () => true)(frame(state()))).toThrow();
  const validator = createRuntimePresenceValidator(claims, () => false); validator(frame(state())); expect(() => validator(frame(state()))).toThrow();
});
it("permits viewers to observe but rejects fake hosting, requests, and acknowledgements", () => {
  const validate = () => createRuntimePresenceValidator({ userId: user.id, name: user.name, color: user.color, role: "VIEWER" }, () => false);
  const observer = { ...state(), runtime: { ...state().runtime, phase: "idle", previewReady: false } };
  expect(() => validate()(frame(observer))).not.toThrow();
  for (const spoof of [state(), { ...observer, runtime: { ...observer.runtime, controls: true } }, { ...observer, ack: { requestId: crypto.randomUUID(), outcome: "completed" } }, { ...observer, request: { requestId: crypto.randomUUID(), token: "fake", targetClientId: 1, targetNonce: crypto.randomUUID() } }]) expect(() => validate()(frame(spoof))).toThrow();
});

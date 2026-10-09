// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import { SharedRuntimeSession } from "@/features/webcontainers/service/shared-runtime-session";
import type { CollaborationSession } from "@/lib/collaboration-session";
import { collaborationRoom, PROJECT_RUNTIME_PATH } from "@/lib/collaboration-protocol.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
async function harness(canEdit = true) {
  vi.useFakeTimers();
  let settings!: ConstructorParameters<typeof CollaborationSession>[0];
  let awareness!: Awareness;
  const execute = vi.fn(); const onChange = vi.fn();
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (input === "/api/collaboration/token") return Response.json({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: PROJECT_RUNTIME_PATH, revision: 1, room: collaborationRoom("project", PROJECT_RUNTIME_PATH), websocketUrl: "ws://localhost:1234", token: "test-token", role: canEdit ? "EDITOR" : "VIEWER", user: { id: "host", name: "Host", color: "#112233" } } });
    return Response.json({ success: true, data: { requestId: requestId, requesterId: "sender", operation: "stop" } });
  });
  const session = new SharedRuntimeSession({ playgroundId: "project", canEdit, execute, onChange, fetch: fetcher, createTransport: value => {
    settings = value; awareness = new Awareness(value.document);
    return { awareness, start: vi.fn(), retry: vi.fn(), dispose: () => awareness.destroy() } as unknown as CollaborationSession;
  } });
  cleanups.push(() => session.dispose());
  await settings.getToken(new AbortController().signal);
  awareness.setLocalStateField("user", { id: "host", name: "Host", color: "#112233" });
  settings.onState("connected", null); session.start(); session.update("ready", true); await vi.advanceTimersByTimeAsync(500);
  function peer(request = true, id = requestId) {
    awareness.getStates().set(123, { user: { id: "sender", name: "Sender", color: "#445566" }, runtime: { nonce: crypto.randomUUID(), phase: "ready", previewReady: true, controls: true, logs: [] }, request: request ? { requestId: id, token: "signed-request", targetClientId: session.document.clientID, targetNonce: session.nonce } : null, ack: null });
    awareness.meta.set(123, { clock: 1, lastUpdated: Date.now() });
    awareness.emit("change", [{ added: [123], updated: [], removed: [] }, "test"]);
  }
  return { session, awareness, execute, onChange, fetcher, settings, peer };
}
const requestId = "a0472283-f0b9-42f3-9126-13885873facf";

it("requires host opt-in, verifies requests, executes once and rejects replay", async () => {
  const h = await harness(); h.peer(); await vi.advanceTimersByTimeAsync(0);
  expect(h.execute).not.toHaveBeenCalled(); expect(h.awareness.getLocalState()?.ack.outcome).toBe("rejected");
  h.session.allowControls(true); h.peer(); await vi.advanceTimersByTimeAsync(0);
  expect(h.execute).not.toHaveBeenCalled();
  // A fresh session permits the request once; the rejected ID stays consumed.
  const active = await harness(); active.session.allowControls(true); active.peer(); await vi.advanceTimersByTimeAsync(0);
  expect(active.execute).toHaveBeenCalledExactlyOnceWith("stop");
  expect(active.awareness.getLocalState()?.ack.outcome).toBe("completed");
  active.peer(); await vi.advanceTimersByTimeAsync(0); expect(active.execute).toHaveBeenCalledOnce();
  active.session.allowControls(false);
  for (let index = 0; index < 1001; index++) active.peer(true, crypto.randomUUID());
  active.session.allowControls(true); active.peer(); await vi.advanceTimersByTimeAsync(0);
  expect(active.execute).toHaveBeenCalledOnce();
});
it("resets opt-in and peers on disconnect; viewers ignore forged control requests", async () => {
  const h = await harness(); h.session.allowControls(true); h.peer(false);
  expect(h.session.peers()).toHaveLength(1); h.settings.onState("offline", null);
  expect(h.awareness.getLocalState()?.runtime.controls).toBe(false); expect(h.session.peers()).toEqual([]);
  h.settings.onState("connected", null); expect(h.awareness.getLocalState()?.runtime.controls).toBe(false);
  const viewer = await harness(false); viewer.session.allowControls(true); viewer.peer(); await vi.advanceTimersByTimeAsync(0);
  expect(viewer.execute).not.toHaveBeenCalled(); expect(viewer.awareness.getLocalState()?.ack).toBeNull();
  expect(viewer.awareness.getLocalState()?.runtime.phase).toBe("idle");
});
it("bounds projected diagnostics, throttles publication and expires silent peers", async () => {
  const h = await harness(); h.peer(false);
  for (let index = 0; index < 100; index++) h.session.output(index % 2 ? "error SECRET=arbitrary-password" : "ready https://secret.example");
  expect(h.awareness.getLocalState()?.runtime.logs).toEqual([]);
  await vi.advanceTimersByTimeAsync(500);
  const logs = h.awareness.getLocalState()?.runtime.logs;
  expect(logs).toHaveLength(40); expect(JSON.stringify(logs)).not.toMatch(/SECRET|password|https/);
  await vi.advanceTimersByTimeAsync(35_000); expect(h.session.peers()).toEqual([]);
});
it("does not execute when verification fails or the sender leaves during verification", async () => {
  const h = await harness(); h.session.allowControls(true);
  let finish!: (response: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  h.peer(); h.awareness.getStates().delete(123);
  finish(Response.json({ success: true, data: { requestId, requesterId: "sender", operation: "stop" } }));
  await vi.advanceTimersByTimeAsync(0); expect(h.execute).not.toHaveBeenCalled(); expect(h.awareness.getLocalState()?.ack.outcome).toBe("rejected");
  const denied = await harness(); denied.session.allowControls(true); denied.fetcher.mockResolvedValueOnce(Response.json({ success: false }, { status: 403 })); denied.peer();
  await vi.advanceTimersByTimeAsync(0); expect(denied.execute).not.toHaveBeenCalled();
});

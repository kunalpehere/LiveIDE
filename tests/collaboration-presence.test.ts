import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import { PresenceWebsocketProvider } from "@/lib/collaboration-presence";
import { createPresenceEditor } from "@/features/playground/lib/presence-editor";
import type { editor } from "monaco-editor";

const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); });
function fixture() {
  const doc = new Y.Doc(); const awareness = new Awareness(doc);
  const provider = new PresenceWebsocketProvider("ws://127.0.0.1:1234", "room", doc, { awareness, connect: false });
  const send = vi.fn();
  provider.ws = { OPEN: 1, readyState: 1, send, close: vi.fn() } as unknown as WebSocket;
  provider.wsconnected = true;
  cleanups.push(() => { provider.destroy(); awareness.destroy(); doc.destroy(); });
  return { doc, awareness, provider, send };
}
function frameType(raw: Uint8Array) { return decoding.readVarUint(decoding.createDecoder(raw)); }
function lastPresence(send: ReturnType<typeof vi.fn>, doc: Y.Doc) {
  const raw = send.mock.calls.filter(([bytes]) => frameType(bytes) === 1).at(-1)![0];
  const decoder = decoding.createDecoder(raw); decoding.readVarUint(decoder);
  const copy = new Y.Doc(); const awareness = new Awareness(copy);
  applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), "test");
  const result = awareness.getStates().get(doc.clientID);
  awareness.destroy(); copy.destroy(); return result;
}

describe("ephemeral presence", () => {
  it("coalesces 1,000 cursor events into leading/latest frames within 50 ms without delaying document edits", async () => {
    const { doc, awareness, send } = fixture();
    const before = Y.encodeStateAsUpdate(doc);
    for (let index = 0; index < 1000; index++) awareness.setLocalStateField("selection", { index });
    expect(send).toHaveBeenCalledOnce(); expect(lastPresence(send, doc)?.selection.index).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.getText("content").insert(0, "immediate edit");
    expect(send.mock.calls.map(([raw]) => frameType(raw))).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(49); expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledTimes(3);
    expect(lastPresence(send, doc)?.selection.index).toBe(999);
    const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(restored.getText("content").toString()).toBe("immediate edit");
    expect(Array.from(restored.share.keys())).toEqual(["content"]); restored.destroy();
  });

  it("never echoes received presence and removes silent peers within the awareness TTL", async () => {
    const { awareness, provider, send } = fixture();
    const remoteDoc = new Y.Doc(); const remote = new Awareness(remoteDoc);
    remote.setLocalStateField("user", { name: "Peer" });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remote, [remoteDoc.clientID]), provider);
    expect(awareness.getStates().size).toBe(2); expect(send).not.toHaveBeenCalled();
    remote.destroy(); remoteDoc.destroy();
    // lib0 captures Date.now at module load; age the peer explicitly, then
    // advance the actual awareness sweeper's three-second polling timer.
    awareness.meta.get(remoteDoc.clientID)!.lastUpdated -= 33_000;
    await vi.advanceTimersByTimeAsync(3000);
    expect(awareness.getStates().size).toBe(1);
    // Any packets in this interval are local heartbeat renewals, never Peer.
    send.mock.calls.forEach(([raw]) => {
      const decoder = decoding.createDecoder(raw); decoding.readVarUint(decoder);
      const payload = decoding.createDecoder(decoding.readVarUint8Array(decoder));
      expect(decoding.readVarUint(payload)).toBe(1);
      expect(decoding.readVarUint(payload)).toBe(awareness.clientID);
    });
  });

  it("sends removal immediately and cancels a queued cursor without resurrecting presence", async () => {
    const { awareness, doc, send } = fixture();
    awareness.setLocalStateField("selection", { index: 0 });
    awareness.setLocalStateField("selection", { index: 1 });
    awareness.setLocalState(null);
    expect(send).toHaveBeenCalledTimes(2); expect(lastPresence(send, doc)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100); expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancels queued updates on provider retirement", async () => {
    const { awareness, provider, send } = fixture();
    awareness.setLocalStateField("selection", { index: 0 }); awareness.setLocalStateField("selection", { index: 1 });
    provider.destroy(); const count = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100); expect(send).toHaveBeenCalledTimes(count);
  });

  it("disposes Monaco cursor listeners and decorations without touching the editor's other decorations", () => {
    const dispose = vi.fn(); const delta = vi.fn().mockReturnValue(["owned-cursor"]);
    const target = { onDidChangeCursorSelection: vi.fn(() => ({ dispose })), deltaDecorations: delta,
      getModel: () => ({ isDisposed: () => false }) } as unknown as editor.IStandaloneCodeEditor;
    const wrapped = createPresenceEditor(target);
    wrapped.editor.onDidChangeCursorSelection(() => {}); wrapped.editor.deltaDecorations([], []);
    wrapped.dispose(); wrapped.dispose();
    expect(dispose).toHaveBeenCalledOnce(); expect(delta).toHaveBeenLastCalledWith(["owned-cursor"], []);
  });
  it("does not publish transient cursor movement caused by presence decoration rendering", () => {
    let selectionListener: (() => void) | undefined;
    const target = {
      onDidChangeCursorSelection: (listener: () => void) => { selectionListener = listener; return { dispose: vi.fn() }; },
      deltaDecorations: vi.fn(() => { selectionListener?.(); return ["presence"]; }),
      getModel: () => ({ isDisposed: () => false }),
    } as unknown as editor.IStandaloneCodeEditor;
    const wrapped = createPresenceEditor(target);
    const publish = vi.fn();
    wrapped.editor.onDidChangeCursorSelection(publish);
    wrapped.editor.deltaDecorations([], []);
    expect(publish).not.toHaveBeenCalled();
    selectionListener?.();
    expect(publish).toHaveBeenCalledOnce();
    wrapped.dispose();
  });
});

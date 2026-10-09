import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Observable } from "lib0/observable";
import { CollaborationSession, type SessionProvider } from "@/lib/collaboration-session";
import { CollaborationProtocolError, collaborationRoom } from "@/lib/collaboration-protocol.mjs";
import type { TokenResponse } from "@/lib/collaboration-protocol";

class FakeProvider extends Observable<string> {
  shouldConnect = false;
  ws = null;
  connect = vi.fn(() => { this.shouldConnect = true; });
  destroy = vi.fn(() => { this.shouldConnect = false; super.destroy(); });
  sync() { this.emit("sync", [true]); }
  close(code = 1006) { this.emit("connection-close", [{ code }]); }
}

const data: TokenResponse["data"] = { protocolVersion: 1, playgroundId: "project", filePath: "src/App.tsx", revision: 1,
  room: collaborationRoom("project", "src/App.tsx", 1), role: "EDITOR" as const, websocketUrl: "ws://127.0.0.1:1234", token: "test-token",
  user: { id: "user", name: "User", color: "#112233" } };
const cleanups: (() => void)[] = [];
function harness(overrides: Partial<ConstructorParameters<typeof CollaborationSession>[0]> = {}) {
  const doc = new Y.Doc();
  const providers: FakeProvider[] = [];
  const network = new EventTarget();
  const onState = vi.fn(); const getToken = vi.fn(async () => data);
  let online = true;
  const createProvider = vi.fn(() => { const provider = new FakeProvider(); providers.push(provider); return provider as SessionProvider; });
  const session = new CollaborationSession({ document: doc, getToken, onState, onSynced: vi.fn(), WebSocket: globalThis.WebSocket,
    networkEvents: network, isOnline: () => online, random: () => 0, createProvider, ...overrides });
  cleanups.push(() => { session.dispose(); doc.destroy(); });
  return { session, doc, providers, createProvider, getToken, onState, network,
    offline: () => { online = false; network.dispatchEvent(new Event("offline")); },
    online: () => { online = true; network.dispatchEvent(new Event("online")); } };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); });

describe("collaboration recovery ownership", () => {
  it("waits offline, synchronizes before connected, and preserves one document/presence through duplicate network events", async () => {
    const h = harness(); h.offline(); h.session.start();
    expect(h.getToken).not.toHaveBeenCalled(); expect(h.onState.mock.lastCall?.[0]).toBe("offline");
    h.online(); h.online(); h.session.start(); await flush();
    expect(h.createProvider).toHaveBeenCalledTimes(1); expect(h.onState.mock.lastCall?.[0]).toBe("connecting");
    h.providers[0].sync(); expect(h.onState.mock.lastCall?.[0]).toBe("connected");
    const identity = h.doc.clientID; const awareness = h.session.awareness;
    awareness.getStates().set(123, { user: { name: "Remote" } });
    awareness.meta.set(123, { clock: 1, lastUpdated: Date.now() });
    h.providers[0].close(); await flush();
    expect(h.providers[0].shouldConnect).toBe(false); expect(h.providers[0].destroy).toHaveBeenCalledOnce();
    expect(h.onState.mock.lastCall?.[0]).toBe("reconnecting"); expect(awareness.getStates().size).toBe(1);
    h.doc.getText("content").insert(0, "offline edit");
    await vi.advanceTimersByTimeAsync(250); h.providers[1].sync();
    expect(h.getToken).toHaveBeenCalledTimes(2); expect(h.doc.clientID).toBe(identity);
    expect(h.session.awareness).toBe(awareness); expect(h.doc.getText("content").toString()).toBe("offline edit");
    expect(h.createProvider.mock.calls[1]).toBeDefined();
    expect(h.providers[0]._observers.size).toBe(0);
  });

  it("bounds exponential jittered waits and attempts, then allows an explicit retry", async () => {
    const getToken = vi.fn(async (): Promise<typeof data> => { throw new Error("Transport unavailable"); });
    const h = harness({ getToken, policy: { baseDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 4 } });
    h.session.start(); await flush(); expect(getToken).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [500, 750, 750].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(getToken).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1); expect(getToken).toHaveBeenCalledTimes(index + 2);
    }
    expect(h.onState.mock.lastCall?.[0]).toBe("failed");
    await vi.advanceTimersByTimeAsync(100_000); h.online(); await flush(); expect(getToken).toHaveBeenCalledTimes(4);
    getToken.mockImplementation(async () => data);
    h.session.retry(); h.session.retry(); await flush();
    expect(getToken).toHaveBeenCalledTimes(5); expect(h.providers).toHaveLength(1);
    h.providers[0].sync(); expect(h.onState.mock.lastCall?.[0]).toBe("connected");
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN", "VERSION_MISMATCH", "ROOM_MISMATCH"] as const)("stops automatically after %s", async code => {
    const getToken = vi.fn(async () => { throw new CollaborationProtocolError(code); });
    const h = harness({ getToken }); h.session.start(); await flush();
    expect(h.onState.mock.lastCall?.[0]).toBe("failed");
    await vi.advanceTimersByTimeAsync(100_000); h.online(); await flush();
    expect(getToken).toHaveBeenCalledOnce(); expect(h.createProvider).not.toHaveBeenCalled();
  });

  it("aborts requests and rejects stale completions after offline transitions and disposal", async () => {
    let finish!: (value: typeof data) => void;
    let signal!: AbortSignal;
    const getToken = vi.fn((value: AbortSignal) => { signal = value; return new Promise<typeof data>(resolve => { finish = resolve; }); });
    const h = harness({ getToken });
    const remove = vi.spyOn(h.network, "removeEventListener");
    h.session.start(); h.offline(); expect(signal.aborted).toBe(true);
    finish(data); await flush(); expect(h.createProvider).not.toHaveBeenCalled();
    h.online(); h.session.dispose(); expect(signal.aborted).toBe(true);
    finish(data); await flush(); h.online();
    expect(h.createProvider).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(2);
  });

  it("times out an unsynchronized socket and cancels retry timers on disposal", async () => {
    const h = harness({ policy: { attemptTimeoutMs: 100 } }); h.session.start(); await flush();
    await vi.advanceTimersByTimeAsync(100); expect(h.providers[0].destroy).toHaveBeenCalledOnce();
    expect(h.onState.mock.lastCall?.[0]).toBe("reconnecting");
    h.session.dispose(); await vi.advanceTimersByTimeAsync(20_000);
    expect(h.getToken).toHaveBeenCalledOnce(); expect(h.providers).toHaveLength(1);
  });

  it("stops on policy rejection and refuses to move an existing document into a new revision", async () => {
    const h = harness(); h.session.start(); await flush(); h.providers[0].sync();
    h.providers[0].close(1008); await flush(); expect(h.onState.mock.lastCall?.[0]).toBe("failed");
    h.getToken.mockResolvedValue({ ...data, revision: 2, room: collaborationRoom("project", data.filePath, 2) });
    h.session.retry(); await flush();
    expect(h.onState.mock.lastCall?.[0]).toBe("failed"); expect(h.providers).toHaveLength(1);
  });
  it("renews expired sessions with fresh authorization and stops if the role changed", async () => {
    const h = harness(); h.session.start(); await flush(); h.providers[0].sync();
    h.doc.getText("content").insert(0, "pending edit"); h.providers[0].close(4001); await flush();
    await vi.advanceTimersByTimeAsync(250); expect(h.getToken).toHaveBeenCalledTimes(2); h.providers[1].sync();
    expect(h.doc.getText("content").toString()).toBe("pending edit");
    h.getToken.mockResolvedValue({ ...data, role: "VIEWER" });
    h.providers[1].close(4001); await flush(); await vi.advanceTimersByTimeAsync(250);
    expect(h.onState.mock.lastCall?.[0]).toBe("failed"); expect(h.providers).toHaveLength(2);
  });
});

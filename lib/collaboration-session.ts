import * as Y from "yjs";
import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import { CollaborationProtocolError } from "./collaboration-protocol.mjs";
import { createProtocolWebSocket } from "./collaboration-websocket.mjs";
import type { TokenResponse } from "./collaboration-protocol";
import { PresenceWebsocketProvider } from "./collaboration-presence";
import { TimingWindow } from "./collaboration-metrics.mjs";

export type CollaborationStatus = "connecting" | "connected" | "reconnecting" | "offline" | "failed";
type SessionData = TokenResponse["data"];
type ProviderOptions = { connect: false; disableBc: true; awareness: Awareness; params: { token: string }; WebSocketPolyfill: typeof WebSocket };
export type SessionProvider = Pick<WebsocketProvider, "connect" | "destroy" | "on" | "off" | "shouldConnect" | "ws">;

export const RECOVERY_POLICY = { baseDelayMs: 500, maxDelayMs: 15_000, maxAttempts: 8, attemptTimeoutMs: 15_000 };

/** One retry owner per room. The document and awareness survive transport changes. */
export class CollaborationSession {
  readonly awareness: Awareness;
  readonly applicationTiming = new TimingWindow();
  private provider?: SessionProvider;
  private abort?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private attempts = 0;
  private started = false;
  private disposed = false;
  private failed = false;
  private identity?: SessionData;
  private handlers?: { close: (event: CloseEvent) => void; sync: (synced: boolean) => void };
  private readonly policy: typeof RECOVERY_POLICY;

  constructor(private readonly options: {
    document: Y.Doc;
    getToken: (signal: AbortSignal) => Promise<SessionData>;
    onState: (state: CollaborationStatus, message: string | null) => void;
    onSynced: () => void;
    WebSocket: typeof WebSocket;
    isOnline?: () => boolean;
    networkEvents?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
    random?: () => number;
    policy?: Partial<typeof RECOVERY_POLICY>;
    createProvider?: (url: string, room: string, doc: Y.Doc, options: ProviderOptions) => SessionProvider;
  }) {
    this.awareness = new Awareness(options.document);
    this.policy = { ...RECOVERY_POLICY, ...options.policy };
  }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.options.networkEvents?.addEventListener("offline", this.offline);
    this.options.networkEvents?.addEventListener("online", this.online);
    if (this.isOnline()) void this.attempt(); else this.offline();
  }

  retry = () => {
    if (this.disposed || !this.failed) return;
    this.failed = false;
    this.attempts = 0;
    if (this.isOnline()) void this.attempt(); else this.offline();
  };

  private isOnline() { return this.options.isOnline?.() ?? true; }
  private offline = () => {
    if (this.disposed || this.failed) return;
    this.cancelAttempt();
    this.options.onState("offline", "Offline — edits stay in this open tab until collaboration reconnects.");
  };
  private online = () => {
    if (this.disposed || this.failed || this.provider || this.abort || this.retryTimer) return;
    void this.attempt();
  };

  private cancelAttempt() {
    this.generation++;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    clearTimeout(this.deadline); this.deadline = undefined;
    this.abort?.abort(); this.abort = undefined;
    const provider = this.provider;
    this.provider = undefined;
    if (provider) {
      provider.shouldConnect = false;
      if (this.handlers) {
        provider.off("connection-close", this.handlers.close);
        provider.off("sync", this.handlers.sync);
      }
      // Upstream destroy closes the socket but leaves native callbacks attached.
      // Retired sockets must not apply late messages to this surviving document
      // or clear the new connection's awareness when their close arrives later.
      if (provider.ws) {
        // Node's ws polyfill emits an error if a connecting socket is retired.
        provider.ws.addEventListener("error", () => {});
        provider.ws.onmessage = null; provider.ws.onopen = null;
        provider.ws.onerror = null; provider.ws.onclose = null;
      }
      provider.destroy();
    }
    this.handlers = undefined;
    const remoteIds = Array.from(this.awareness.meta.keys()).filter(id => id !== this.options.document.clientID);
    removeAwarenessStates(this.awareness, remoteIds, this);
    // Transport-local absence is not a newer remote presence announcement.
    // Accept the next socket's snapshot even when a peer's clock has not moved.
    remoteIds.forEach(id => this.awareness.meta.delete(id));
  }

  private fail(message: string) {
    this.failed = true;
    this.cancelAttempt();
    this.options.onState("failed", message);
  }

  private recover() {
    this.cancelAttempt();
    if (!this.isOnline()) { this.offline(); return; }
    if (this.attempts >= this.policy.maxAttempts) {
      this.fail("Collaboration could not reconnect. Check the service or your access, then retry."); return;
    }
    this.options.onState("reconnecting", null);
    const cap = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** Math.max(0, this.attempts - 1));
    // Equal jitter bounds every wait to [cap/2, cap], including the maximum.
    const delay = Math.floor(cap * (0.5 + 0.5 * (this.options.random?.() ?? Math.random())));
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.attempt(); }, delay);
  }

  private async attempt() {
    if (this.disposed || this.failed || this.provider || this.abort) return;
    if (!this.isOnline()) { this.offline(); return; }
    const generation = ++this.generation;
    const current = () => !this.disposed && !this.failed && generation === this.generation;
    this.options.onState(this.identity || this.attempts ? "reconnecting" : "connecting", null);
    this.attempts++;
    const abort = new AbortController(); this.abort = abort;
    this.deadline = setTimeout(() => { if (current()) this.recover(); }, this.policy.attemptTimeoutMs);
    try {
      const data = await this.options.getToken(abort.signal);
      if (!current()) return;
      if (this.identity && data.role !== this.identity.role) throw new CollaborationProtocolError("FORBIDDEN");
      if (this.identity && (data.room !== this.identity.room || data.playgroundId !== this.identity.playgroundId || data.filePath !== this.identity.filePath || data.revision !== this.identity.revision || data.user.id !== this.identity.user.id)) {
        throw new CollaborationProtocolError("ROOM_MISMATCH");
      }
      this.identity = data;
      this.abort = undefined;
      this.awareness.setLocalStateField("user", data.user);
      this.awareness.setLocalStateField("activeFile", data.filePath);
      const provider = (this.options.createProvider ?? ((url, room, doc, opts) => new PresenceWebsocketProvider(url, room, doc, opts)))(data.websocketUrl, data.room, this.options.document, {
        connect: false, disableBc: true, awareness: this.awareness, params: { token: data.token },
        WebSocketPolyfill: createProtocolWebSocket(this.options.WebSocket, failure => { if (current()) this.fail(failure.message); },
          process.env.NODE_ENV === "development" ? sample => { if (current()) this.applicationTiming.record(sample.applyMs); } : undefined),
      });
      this.provider = provider;
      const close = (event: CloseEvent) => {
        // Set before upstream schedules its own retry; its delayed setup sees
        // shouldConnect=false. Only this session may initiate the next socket.
        provider.shouldConnect = false;
        queueMicrotask(() => {
          if (!current()) return;
          if ([1002, 1008, 1009, 4003, 4009].includes(event.code)) this.fail("Collaboration access changed or this session was rejected. Reload the project or check your access.");
          else this.recover();
        });
      };
      const sync = (synced: boolean) => {
        if (!synced || !current()) return;
        clearTimeout(this.deadline); this.deadline = undefined;
        this.attempts = 0;
        this.options.onState("connected", null);
        this.options.onSynced();
      };
      this.handlers = { close, sync };
      provider.on("connection-close", close); provider.on("sync", sync);
      provider.connect();
    } catch (error) {
      if (!current()) return;
      if (error instanceof CollaborationProtocolError && error.code !== "UNAVAILABLE") this.fail(error.message);
      else this.recover();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.options.networkEvents?.removeEventListener("offline", this.offline);
    this.options.networkEvents?.removeEventListener("online", this.online);
    this.cancelAttempt();
    this.awareness.destroy();
  }
}

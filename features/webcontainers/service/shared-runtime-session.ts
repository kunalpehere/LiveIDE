import * as Y from "yjs";
import type { z } from "zod";
import { CollaborationSession, type CollaborationStatus } from "@/lib/collaboration-session";
import { CollaborationProtocolError, errorResponseSchema, parseTokenResponse, PROJECT_RUNTIME_PATH, PROTOCOL_VERSION } from "@/lib/collaboration-protocol.mjs";
import { classifyRuntimeOutput, RUNTIME_LOG_LIMIT, RUNTIME_PUBLISH_INTERVAL, runtimeOperationAllowed, runtimePresenceSchema } from "@/lib/shared-runtime.mjs";

export type RuntimePresence = z.infer<typeof runtimePresenceSchema>;
export type RuntimePeer = RuntimePresence & { clientId: number };
export type RuntimeOperation = "start" | "stop" | "restart";
export class SharedRuntimeSession {
  readonly document = new Y.Doc();
  readonly nonce = crypto.randomUUID();
  readonly transport: CollaborationSession;
  private state: CollaborationStatus = "connecting";
  private revision = 0;
  private allowed = false;
  private disposed = false;
  private controls = false;
  private busy = false;
  private requesting = false;
  private seen = new Map<string, number>();
  private requests = new Set<AbortController>();
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private pending?: { requestId: string; clientId: number; nonce: string };
  private phase: RuntimePresence["runtime"]["phase"] = "idle";
  private previewReady = false;
  private logs: RuntimePresence["runtime"]["logs"] = [];
  private sequence = 0;
  constructor(private options: {
    playgroundId: string; canEdit: boolean;
    onChange: (state: CollaborationStatus, peers: RuntimePeer[], message?: string) => void;
    execute: (operation: RuntimeOperation) => void | Promise<void>;
    fetch?: typeof fetch;
    createTransport?: (options: ConstructorParameters<typeof CollaborationSession>[0]) => CollaborationSession;
  }) {
    this.transport = (options.createTransport ?? (settings => new CollaborationSession(settings)))({
      document: this.document, WebSocket, networkEvents: window, isOnline: () => navigator.onLine,
      getToken: async signal => {
        const response = await this.fetch("/api/collaboration/token", { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, playgroundId: options.playgroundId, filePath: PROJECT_RUNTIME_PATH }) });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) { const failure = errorResponseSchema.safeParse(body); throw new CollaborationProtocolError(failure.success ? failure.data.error.code : "UNAVAILABLE"); }
        const data = parseTokenResponse(body).data;
        if (data.playgroundId !== options.playgroundId || data.filePath !== PROJECT_RUNTIME_PATH) throw new CollaborationProtocolError("ROOM_MISMATCH");
        this.allowed = data.role !== "VIEWER" && options.canEdit; this.revision = data.revision; return data;
      },
      onState: state => {
        this.state = state;
        if (state !== "connected") { this.controls = false; this.clearPending(); this.publish(); this.notify("Runtime sharing disconnected. Remote controls are disabled."); }
        else this.notify("Runtime sharing connected.");
      },
      onSynced: () => this.publish(),
    });
    this.transport.awareness.setLocalState({ runtime: { nonce: this.nonce, phase: "idle", previewReady: false, controls: false, logs: [] }, request: null, ack: null });
    this.transport.awareness.on("change", this.changed);
  }
  private fetch(input: RequestInfo | URL, init?: RequestInit) { return (this.options.fetch ?? fetch)(input, init); }
  start() { this.transport.start(); this.heartbeat = setInterval(() => { if (this.state === "connected") { this.publish(); this.changed(); } }, 5000); }
  retry() { this.transport.retry(); }
  peers(): RuntimePeer[] {
    if (this.state !== "connected") return [];
    return Array.from(this.transport.awareness.getStates()).flatMap(([clientId, value]) => {
      const parsed = runtimePresenceSchema.safeParse(value);
      const fresh = Date.now() - (this.transport.awareness.meta.get(clientId)?.lastUpdated ?? 0) <= 30_000;
      return clientId !== this.document.clientID && fresh && parsed.success ? [{ ...parsed.data, clientId }] : [];
    });
  }
  private notify(message?: string) { if (!this.disposed) this.options.onChange(this.state, this.peers(), message); }
  private changed = () => {
    if (this.disposed || this.state !== "connected") return;
    for (const [id, receivedAt] of this.seen) if (Date.now() - receivedAt > 60_000) this.seen.delete(id);
    const peers = this.peers();
    if (this.pending) {
      const host = peers.find(peer => peer.clientId === this.pending?.clientId && peer.runtime.nonce === this.pending.nonce);
      if (!host) { this.clearPending(); this.notify("The runtime host left. Request cancelled."); }
      else if (host.ack?.requestId === this.pending.requestId) {
        const outcome = host.ack.outcome;
        if (outcome !== "accepted") this.clearPending();
        this.notify(`Runtime request ${outcome}.`);
      }
    }
    for (const peer of peers) {
      const request = peer.request;
      if (request && request.targetClientId === this.document.clientID && request.targetNonce === this.nonce && !this.seen.has(request.requestId)) {
        // Never evict an unexpired replay guard to admit new requests.
        if (this.seen.size >= 1000) continue;
        this.seen.set(request.requestId, Date.now());
        void this.receive(peer);
      }
    }
    this.notify();
  };
  private publish = () => {
    if (this.disposed) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.transport.awareness.setLocalStateField("runtime", { nonce: this.nonce, phase: this.allowed ? this.phase : "idle", previewReady: this.allowed && this.previewReady, controls: this.allowed && this.controls && this.state === "connected", logs: this.allowed ? this.logs : [] });
  };
  private schedule() { if (!this.timer) this.timer = setTimeout(this.publish, RUNTIME_PUBLISH_INTERVAL); }
  update(phase: RuntimePresence["runtime"]["phase"], previewReady: boolean) { this.phase = phase; this.previewReady = phase === "ready" && previewReady; this.schedule(); }
  output(raw: string) {
    if (!this.options.canEdit || this.disposed) return;
    const event = classifyRuntimeOutput(raw);
    if (this.logs.at(-1)?.event === event) return;
    const log: RuntimePresence["runtime"]["logs"][number] = { sequence: ++this.sequence, event };
    this.logs = [...this.logs, log].slice(-RUNTIME_LOG_LIMIT); this.schedule();
  }
  allowControls(allow: boolean) { this.controls = allow && this.allowed && this.state === "connected"; this.publish(); }
  private clearPending() {
    clearTimeout(this.deadline); this.deadline = undefined; this.pending = undefined;
    if (!this.disposed) this.transport.awareness.setLocalStateField("request", null);
  }
  async request(clientId: number, operation: RuntimeOperation) {
    const host = this.peers().find(peer => peer.clientId === clientId);
    if (!this.allowed || this.requesting || this.pending || !host?.runtime.controls || !runtimeOperationAllowed(operation, host.runtime.phase)) { this.notify("This runtime operation is unavailable."); return; }
    this.requesting = true;
    const controller = new AbortController(); this.requests.add(controller);
    try {
      const response = await this.fetch("/api/collaboration/runtime-control", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "request", playgroundId: this.options.playgroundId, targetUserId: host.user.id, targetClientId: host.clientId, targetNonce: host.runtime.nonce, revision: this.revision, operation }) });
      const result = await response.json();
      if (this.disposed) return;
      if (!response.ok || !result.success || !this.peers().some(peer => peer.clientId === clientId && peer.runtime.nonce === host.runtime.nonce && peer.runtime.controls)) { this.notify("Runtime request rejected or host unavailable."); return; }
      this.pending = { requestId: result.data.requestId, clientId, nonce: host.runtime.nonce };
      this.deadline = setTimeout(() => { this.clearPending(); this.notify("Runtime request timed out. Check the host status before retrying."); }, 150_000);
      this.transport.awareness.setLocalStateField("request", { ...result.data, targetClientId: clientId, targetNonce: host.runtime.nonce }); this.notify("Runtime request sent.");
    } catch { if (!this.disposed) this.notify("Could not send the runtime request."); }
    finally { this.requesting = false; this.requests.delete(controller); }
  }
  private async receive(peer: RuntimePeer) {
    const request = peer.request!;
    const acknowledge = (outcome: "accepted" | "completed" | "rejected" | "failed") => { if (!this.disposed) this.transport.awareness.setLocalStateField("ack", { requestId: request.requestId, outcome }); };
    if (!this.allowed) return;
    if (!this.controls || this.busy) { acknowledge("rejected"); return; }
    this.busy = true;
    const controller = new AbortController(); this.requests.add(controller);
    try {
      const response = await this.fetch("/api/collaboration/runtime-control", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", playgroundId: this.options.playgroundId, token: request.token, clientId: this.document.clientID, nonce: this.nonce }) });
      const result = await response.json();
      if (this.disposed) return;
      const senderPresent = this.peers().some(sender => sender.clientId === peer.clientId && sender.user.id === peer.user.id && sender.request?.requestId === request.requestId);
      if (!response.ok || !result.success || result.data.requestId !== request.requestId || result.data.requesterId !== peer.user.id || !senderPresent || !this.controls || this.state !== "connected" || !runtimeOperationAllowed(result.data.operation, this.phase)) { acknowledge("rejected"); return; }
      acknowledge("accepted"); await this.options.execute(result.data.operation); acknowledge("completed");
    } catch { acknowledge("failed"); }
    finally { this.busy = false; this.requests.delete(controller); }
  }
  dispose() {
    this.disposed = true; clearTimeout(this.timer); clearInterval(this.heartbeat); clearTimeout(this.deadline); this.requests.forEach(controller => controller.abort()); this.requests.clear();
    this.transport.awareness.off("change", this.changed); this.transport.dispose(); this.document.destroy();
  }
}

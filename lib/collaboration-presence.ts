import { WebsocketProvider } from "y-websocket";
import { encodeAwarenessUpdate } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";

export const PRESENCE_INTERVAL_MS = 50;

/** Presence uses its own ephemeral channel; document updates retain their timing. */
export class PresenceWebsocketProvider extends WebsocketProvider {
  private pending?: ReturnType<typeof setTimeout>;
  private lastSent = -Infinity;

  constructor(...args: ConstructorParameters<typeof WebsocketProvider>) {
    super(args[0], args[1], args[2], { ...args[3], connect: false, disableBc: true });
    this.awareness.off("update", this._awarenessUpdateHandler);
    this._awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      // Never rebroadcast another participant's cursor/heartbeat/removal.
      if (![...added, ...updated, ...removed].includes(this.doc.clientID)) return;
      if (this.awareness.getLocalState() === null) { this.cancelPending(); this.sendPresence(); return; }
      if (!this.wsconnected || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
      const wait = Math.max(0, PRESENCE_INTERVAL_MS - (Date.now() - this.lastSent));
      if (wait === 0) { this.cancelPending(); this.sendPresence(); }
      else if (!this.pending) this.pending = setTimeout(() => { this.pending = undefined; this.sendPresence(); }, wait);
    };
    this.awareness.on("update", this._awarenessUpdateHandler);
  }

  private sendPresence() {
    if (!this.wsconnected || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    // Encode at send time: the trailing message carries the latest selection.
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
    this.ws.send(encoding.toUint8Array(encoder));
    this.lastSent = Date.now();
  }

  private cancelPending() { clearTimeout(this.pending); this.pending = undefined; }
  disconnect() { this.cancelPending(); super.disconnect(); }
  destroy() { this.cancelPending(); super.destroy(); }
}

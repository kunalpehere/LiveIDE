import { WEBSOCKET_PROTOCOL, encodeFrame, decodeFrame, CollaborationProtocolError, configureYjsValidation } from "./collaboration-protocol.mjs";
import * as Y from "yjs";
configureYjsValidation(Y.decodeUpdate);

/** @param {typeof WebSocket} Base @param {(error: CollaborationProtocolError) => void} [onProtocolError]
 * @param {(sample: {applyMs: number, decodeMs: number, bytes: number}) => void} [onApplied] */
export function createProtocolWebSocket(Base, onProtocolError = () => {}, onApplied) {
  return class ProtocolWebSocket extends Base {
    /** @param {string | URL} url */
    constructor(url) {
      super(url, WEBSOCKET_PROTOCOL);
      /** @type {((this: WebSocket, event: MessageEvent) => unknown) | null} */
      let handler = null;
      // y-websocket assigns onmessage. Keep native binary events private to the
      // adapter and hand the provider only validated, unwrapped Yjs messages.
      Object.defineProperty(this, "onmessage", { get: () => handler, set: value => { handler = value; } });
      this.addEventListener("message", event => {
        try {
          const started = onApplied ? performance.now() : 0;
          const message = decodeFrame(event.data);
          const bytes = message.payload.slice().buffer;
          const decoded = onApplied ? performance.now() : 0;
          handler?.call(this, new MessageEvent("message", { data: bytes }));
          if (handler && message.type === "sync" && message.subtype !== 0) onApplied?.({ applyMs: performance.now() - decoded, decodeMs: decoded - started, bytes: message.payload.byteLength + 5 });
        } catch (error) {
          const failure = error instanceof CollaborationProtocolError ? error : new CollaborationProtocolError("MALFORMED_MESSAGE");
          onProtocolError(failure);
          this.close(1002, failure.code);
        }
      });
    }
    /** @param {string | ArrayBufferLike | Blob | ArrayBufferView} data */
    send(data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
      super.send(encodeFrame(bytes));
    }
  };
}

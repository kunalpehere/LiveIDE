import { encodeFrame, decodeFrame, validateYjsMessage, CollaborationProtocolError } from "../lib/collaboration-protocol.mjs";

/** @param {import("ws").WebSocket} socket @param {(error: CollaborationProtocolError) => void} onFailure
 * @param {{readOnly?: boolean, validatePresence?: (raw: Uint8Array) => void, validateAccess?: () => void, authorize?: (message: ReturnType<typeof validateYjsMessage>) => Promise<void>, onMeasured?: (sample: {processingMs: number, authorizationMs: number}) => void}} [options] */
export function protocolServerSocket(socket, onFailure, options = {}) {
  let applyingRemoteUpdate = false;
  let queue = Promise.resolve();
  let pending = 0;
  const reject = (/** @type {unknown} */ error) => {
    const failure = error instanceof CollaborationProtocolError ? error : new CollaborationProtocolError("UNAVAILABLE");
    onFailure(failure);
    socket.close(failure.code === "UNAUTHORIZED" ? 4001 : failure.code === "ROOM_MISMATCH" ? 4009 : failure.code === "FORBIDDEN" ? 1008 : failure.code === "UNAVAILABLE" ? 1013 : 1002, failure.code);
  };
  // The upstream room engine operates on raw Yjs bytes. This boundary validates
  // before dispatch and wraps outbound sync and awareness application frames.
  return new Proxy(socket, {
    get(target, property) {
      if (property === "send") return (/** @type {Uint8Array} */ bytes, /** @type {(error?: Error) => void} */ callback) => {
        try {
          const message = validateYjsMessage(bytes);
          // Viewers initiate a one-way state-vector handshake. Never request
          // their local state, including cached or offline content.
          if (options.readOnly && message.type === "sync" && message.subtype === 0) { callback?.(); return; }
          // Upstream broadcasts synchronously during applyUpdate, including to
          // its origin. Skip only that origin's update broadcast; step-2 replies
          // and awareness must still be delivered, even during a handshake.
          if (applyingRemoteUpdate && message.type === "sync" && message.subtype === 2) { callback?.(); return; }
          target.send(encodeFrame(bytes), callback);
        }
        catch (error) { onFailure(error instanceof CollaborationProtocolError ? error : new CollaborationProtocolError("MALFORMED_MESSAGE")); target.close(1002, "MALFORMED_MESSAGE"); }
      };
      if (property === "on") return (/** @type {string} */ event, /** @type {(...args: any[]) => void} */ listener) => {
        if (event !== "message") { target.on(event, listener); return target; }
        target.on("message", (data, isBinary) => {
          try {
            if (!isBinary) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
            const started = options.onMeasured ? performance.now() : 0;
            const message = decodeFrame(data);
            if (message.type === "awareness") options.validatePresence?.(message.payload);
            options.validateAccess?.();
            const decodedMs = options.onMeasured ? performance.now() - started : 0;
            if (options.readOnly && message.type === "sync" && message.subtype !== 0) throw new CollaborationProtocolError("FORBIDDEN");
            const dispatch = (authorizationMs = 0) => {
              if (target.readyState !== target.OPEN) return;
              const applying = options.onMeasured ? performance.now() : 0;
              applyingRemoteUpdate = message.type === "sync" && message.subtype !== 0;
              try { listener(message.payload); } finally { applyingRemoteUpdate = false; }
              if (message.type === "sync" && message.subtype !== 0) options.onMeasured?.({ processingMs: decodedMs + performance.now() - applying, authorizationMs });
            };
            if (!options.authorize || message.type !== "sync" || message.subtype === 0) dispatch();
            else {
              if (++pending > 32) throw new CollaborationProtocolError("UNAVAILABLE");
              queue = queue.then(async () => { if (target.readyState === target.OPEN) { const checking = options.onMeasured ? performance.now() : 0; await options.authorize?.(message); dispatch(options.onMeasured ? performance.now() - checking : 0); } }).catch(reject).finally(() => { pending--; });
            }
          } catch (error) {
            reject(error instanceof CollaborationProtocolError ? error : new CollaborationProtocolError("MALFORMED_MESSAGE"));
          }
        });
        return target;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

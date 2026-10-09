import { createClient } from "redis";
import { parseRelayMessage } from "../lib/collaboration-protocol.mjs";
import { writeLog } from "../lib/observability.mjs";

const channelPrefix = "liveide:collaboration:";

export async function createCollaborationRedisBridge({ url, instanceId, onError = (_message, error) => writeLog("error", "collaboration.redis.failed", {}, error) }) {
  if (!url) return null;
  const publisher = createClient({ url, socket: { connectTimeout: 2000, reconnectStrategy: false } });
  const subscriber = publisher.duplicate();
  publisher.on("error", error => onError("Redis publisher error", error));
  subscriber.on("error", error => onError("Redis subscriber error", error));
  try {
    await Promise.all([publisher.connect(), subscriber.connect()]);
  } catch (error) {
    if (publisher.isOpen) publisher.destroy();
    if (subscriber.isOpen) subscriber.destroy();
    throw error;
  }

  const rooms = new Set();
  return {
    isReady: () => publisher.isReady && subscriber.isReady,
    async subscribe(room, onMessage) {
      if (rooms.has(room)) return;
      rooms.add(room);
      await subscriber.subscribe(`${channelPrefix}${room}`, message => {
        try {
          const payload = parseRelayMessage(JSON.parse(message));
          if (payload.room !== room) throw new Error("Redis room mismatch");
          if (payload.instanceId !== instanceId) onMessage(payload);
        } catch (error) {
          onError("Invalid Redis collaboration message", error);
        }
      });
    },
    async publish(message) {
      const payload = parseRelayMessage({ ...message, instanceId });
      await publisher.publish(`${channelPrefix}${payload.room}`, JSON.stringify(payload));
    },
    async close() {
      if (subscriber.isOpen) await subscriber.quit();
      if (publisher.isOpen) await publisher.quit();
    },
  };
}

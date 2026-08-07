import { createClient } from "redis";

const channelPrefix = "liveide:collaboration:";

export async function createCollaborationRedisBridge({ url, instanceId, onError = console.error }) {
  if (!url) return null;
  const publisher = createClient({ url });
  const subscriber = publisher.duplicate();
  publisher.on("error", error => onError("Redis publisher error", error));
  subscriber.on("error", error => onError("Redis subscriber error", error));
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const rooms = new Set();
  return {
    async subscribe(room, onMessage) {
      if (rooms.has(room)) return;
      rooms.add(room);
      await subscriber.subscribe(`${channelPrefix}${room}`, message => {
        try {
          const payload = JSON.parse(message);
          if (payload.instanceId !== instanceId) onMessage(payload);
        } catch (error) {
          onError("Invalid Redis collaboration message", error);
        }
      });
    },
    async publish(room, type, data) {
      await publisher.publish(`${channelPrefix}${room}`, JSON.stringify({ instanceId, type, data }));
    },
    async close() {
      if (subscriber.isOpen) await subscriber.quit();
      if (publisher.isOpen) await publisher.quit();
    },
  };
}


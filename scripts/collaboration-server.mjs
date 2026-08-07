import http from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import { WebSocketServer } from "ws";
import { getYDoc, setupWSConnection } from "y-websocket/bin/utils";
import { createCollaborationRedisBridge } from "./collaboration-redis.mjs";
const require = createRequire(import.meta.url);
const Y = require("yjs");
const awarenessProtocol = require("y-protocols/awareness");

const host = process.env.COLLABORATION_HOST || "127.0.0.1";
const port = Number(process.env.COLLABORATION_PORT || 1234);
const secret = process.env.COLLABORATION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const appUrl = process.env.COLLABORATION_APP_URL || "http://127.0.0.1:3000";
const testMode = process.env.COLLABORATION_TEST_MODE === "true";
const redisUrl = process.env.REDIS_URL;
const instanceId = process.env.COLLABORATION_INSTANCE_ID || randomUUID();
const redisOrigin = Symbol("redis");
let redisBridge = null;
const initializingRooms = new Map();
const roomMetadata = new Map();
const persistTimers = new Map();

if (!secret) throw new Error("COLLABORATION_SECRET (or AUTH_SECRET) is required");
const key = new TextEncoder().encode(secret);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "ok", service: "liveide-collaboration", instanceId, distributed: Boolean(redisBridge) }));
});
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const room = decodeURIComponent(url.pathname.slice(1));
    const token = url.searchParams.get("token");
    if (!room || !token) throw new Error("Missing room or token");
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.scope !== "collaboration:write" || payload.room !== room || typeof payload.playgroundId !== "string" || typeof payload.filePath !== "string" || typeof payload.revision !== "number") {
      throw new Error("Room access denied");
    }
    roomMetadata.set(room, { playgroundId: payload.playgroundId, filePath: payload.filePath, revision: payload.revision });
    if (!testMode && !initializingRooms.has(room)) {
      initializingRooms.set(room, seedRoom(room, payload.playgroundId, payload.filePath, payload.revision));
    }
    if (!testMode) await initializingRooms.get(room);
    // The upstream server derives the document name from request.url. Strip
    // the per-user token so every authorized client joins the same CRDT room.
    request.url = `/${encodeURIComponent(room)}`;

    websocketServer.handleUpgrade(request, socket, head, websocket => {
      websocketServer.emit("connection", websocket, request);
    });
  } catch (error) {
    console.warn("Rejected collaboration connection:", error instanceof Error ? error.message : "unknown error");
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

async function seedRoom(room, playgroundId, filePath, revision) {
  const document = getYDoc(room);
  document.on("update", (update, origin) => {
    if (origin !== "persistence") schedulePersist(room);
    if (redisBridge && origin !== redisOrigin) {
      void redisBridge.publish(room, "update", Buffer.from(update).toString("base64"))
        .catch(error => console.error("Failed to publish collaboration update:", error));
    }
  });
  document.awareness.on("update", ({ added, updated, removed }, origin) => {
    if (!redisBridge || origin === redisOrigin) return;
    const changedClients = added.concat(updated, removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(document.awareness, changedClients);
    void redisBridge.publish(room, "awareness", Buffer.from(update).toString("base64"))
      .catch(error => console.error("Failed to publish collaboration awareness:", error));
  });
  // Subscribe before snapshot hydration. Yjs updates commute, so a live update
  // received during the fetch safely merges with the persisted state.
  if (redisBridge) {
    await redisBridge.subscribe(room, payload => {
      const update = Buffer.from(payload.data, "base64");
      if (payload.type === "update") Y.applyUpdate(document, update, redisOrigin);
      if (payload.type === "awareness") awarenessProtocol.applyAwarenessUpdate(document.awareness, update, redisOrigin);
    });
  }
  if (document.getText("content").length > 0) return;
  const url = new URL("/api/collaboration/snapshot", appUrl);
  url.searchParams.set("playgroundId", playgroundId);
  url.searchParams.set("filePath", filePath);
  url.searchParams.set("room", room);
  url.searchParams.set("revision", String(revision));
  const response = await fetch(url, { headers: { "x-collaboration-secret": secret } });
  if (!response.ok) throw new Error(`Unable to initialize collaboration room (${response.status})`);
  const result = await response.json();
  const state = result?.data?.state;
  if (typeof state === "string" && state) {
    Y.applyUpdate(document, Buffer.from(state, "base64"), "persistence");
  }
  const content = result?.data?.content;
  if (typeof content === "string" && content && document.getText("content").length === 0) {
    document.getText("content").insert(0, content);
  }
}

function schedulePersist(room) {
  clearTimeout(persistTimers.get(room));
  persistTimers.set(room, setTimeout(() => {
    void persistRoom(room).catch(error => console.error("Failed to persist collaboration room:", error));
  }, 1500));
}

async function persistRoom(room) {
  persistTimers.delete(room);
  const metadata = roomMetadata.get(room);
  if (!metadata) return;
  const document = getYDoc(room);
  const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
  const response = await fetch(new URL("/api/collaboration/snapshot", appUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-collaboration-secret": secret },
    body: JSON.stringify({ room, state, ...metadata }),
  });
  if (!response.ok) throw new Error(`Unable to persist collaboration room (${response.status})`);
}

websocketServer.on("connection", (socket, request) => setupWSConnection(socket, request));

async function start() {
  redisBridge = await createCollaborationRedisBridge({
    url: redisUrl,
    instanceId,
    onError: (message, error) => console.error(message, error),
  });
  server.listen(port, host, () => console.log(`LiveIDE collaboration server listening on ws://${host}:${port}${redisBridge ? " with Redis pub/sub" : ""}`));
}
await start();

async function shutdown() {
  await Promise.allSettled(Array.from(roomMetadata.keys(), room => persistRoom(room)));
  websocketServer.clients.forEach(client => client.close(1001, "Server shutting down"));
  await redisBridge?.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

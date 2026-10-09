import http from "node:http";
import { createRequire } from "node:module";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import { WebSocketServer } from "ws";
import { getYDoc, setupWSConnection } from "y-websocket/bin/utils";
import { createCollaborationRedisBridge } from "./collaboration-redis.mjs";
import { getCollaborationConfiguration } from "../lib/runtime-config.mjs";
import { writeLog } from "../lib/observability.mjs";
import { collaborationReadiness } from "./collaboration-health.mjs";
import { PROTOCOL_VERSION, PROJECT_PRESENCE_PATH, PROJECT_RUNTIME_PATH, ephemeralDocument, WEBSOCKET_PROTOCOL, parseClaims, CollaborationProtocolError, protocolErrorResponse, snapshotResponseSchema, snapshotAckSchema, assertRoom, configureYjsValidation } from "../lib/collaboration-protocol.mjs";
import { protocolServerSocket } from "./collaboration-transport.mjs";
import { createSessionAccess } from "./collaboration-access.mjs";
import { TimingWindow } from "../lib/collaboration-metrics.mjs";
import { createFollowPresenceValidator } from "../lib/collaboration-follow.mjs";
import { createRuntimePresenceValidator } from "../lib/shared-runtime.mjs";
const require = createRequire(import.meta.url);
const Y = require("yjs");
configureYjsValidation(Y.decodeUpdate);
const awarenessProtocol = require("y-protocols/awareness");

let config;
try {
  config = getCollaborationConfiguration(process.env, true);
} catch (error) {
  writeLog("error", "collaboration.startup.failed", { code: "INVALID_CONFIGURATION" }, error);
  // Configuration validation emits setting names and fixed explanations only.
  console.error(error.message);
  process.exit(1);
}
const { host, port, secret, appUrl, testMode, redisUrl } = config;
const instanceId = process.env.COLLABORATION_INSTANCE_ID || randomUUID();
const redisOrigin = Symbol("redis");
let redisBridge = null;
const initializingRooms = new Map();
const roomMetadata = new Map();
const persistTimers = new Map();
const diagnosticsEnabled = process.env.NODE_ENV !== "production";
const processing = new TimingWindow();
const authorization = new TimingWindow();
function diagnosticsAuthorized(received) {
  if (typeof received !== "string") return false;
  const left = Buffer.from(received); const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

const key = new TextEncoder().encode(secret);
let shuttingDown = false;
let healthCache;
let healthPending;
function readiness() {
  if (healthCache && healthCache.expires > Date.now()) return Promise.resolve(healthCache.value);
  if (healthPending) return healthPending;
  healthPending = collaborationReadiness({ testMode, redisConfigured: Boolean(redisUrl), redisReady: () => Boolean(redisBridge?.isReady()),
    checkStorage: async () => {
      const response = await fetch(new URL("/api/health/storage", appUrl), { redirect: "error", signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error("Storage unavailable");
      const result = await response.json();
      if (result.service !== "liveide-storage") throw new Error("Invalid storage health response");
      return result.status;
    },
  }).then(value => {
    healthCache = { value, expires: Date.now() + 5000 };
    return value;
  }).finally(() => { healthPending = undefined; });
  return healthPending;
}
const server = http.createServer(async (request, response) => {
  const requestId = randomUUID();
  const path = (request.url || "/").split("?")[0];
  let httpStatus = 200;
  let body;
  if (request.method !== "GET") { httpStatus = 405; body = { code: "METHOD_NOT_ALLOWED" }; }
  else if (path === "/" || path === "/healthz") body = { status: "healthy", service: "liveide-collaboration" };
  else if (path === "/readyz") {
    body = shuttingDown ? { status: "unavailable", service: "liveide-collaboration" } : await readiness();
    if (body.status === "unavailable") httpStatus = 503;
  } else if (path === "/diagnostics" && diagnosticsEnabled) {
    if (!diagnosticsAuthorized(request.headers["x-collaboration-secret"])) { httpStatus = 401; body = { code: "UNAUTHORIZED" }; }
    else body = { service: "liveide-collaboration", activeSockets: websocketServer.clients.size, processing: processing.snapshot(), authorization: authorization.snapshot() };
  } else { httpStatus = 404; body = { code: "NOT_FOUND" }; }
  if (httpStatus >= 500) writeLog("warn", "collaboration.readiness.failed", { requestId, httpStatus });
  response.writeHead(httpStatus, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId, "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
});
server.on("error", error => {
  writeLog("error", "collaboration.startup.failed", { code: "LISTEN_FAILED" }, error);
  process.exit(1);
});
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false,
  handleProtocols: protocols => protocols.has(WEBSOCKET_PROTOCOL) ? WEBSOCKET_PROTOCOL : false,
});

server.on("upgrade", async (request, socket, head) => {
  const requestId = randomUUID();
  try {
    const protocols = String(request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim());
    if (!protocols.includes(WEBSOCKET_PROTOCOL)) throw new CollaborationProtocolError("VERSION_MISMATCH");
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const room = decodeURIComponent(url.pathname.slice(1));
    const token = url.searchParams.get("token");
    if (!room || !token || token.length > 8192) throw new CollaborationProtocolError("UNAUTHORIZED");
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const claims = parseClaims(payload);
    if (claims.room !== room) throw new CollaborationProtocolError("ROOM_MISMATCH");
    const access = createSessionAccess({ claims, token, secret, appUrl, testMode });
    await access.check();
    roomMetadata.set(room, { protocolVersion: PROTOCOL_VERSION, playgroundId: claims.playgroundId, filePath: claims.filePath, revision: claims.revision, role: "EDITOR" });
    if (!testMode && !initializingRooms.has(room)) {
      initializingRooms.set(room, seedRoom(room, claims.playgroundId, claims.filePath, claims.revision).catch(error => { initializingRooms.delete(room); throw error; }));
    }
    if (!testMode) await initializingRooms.get(room);
    // Loading the checkpoint can outlive a token or a membership change.
    await access.check();
    // The upstream server derives the document name from request.url. Strip
    // the per-user token so every authorized client joins the same CRDT room.
    request.url = `/${encodeURIComponent(room)}`;

    websocketServer.handleUpgrade(request, socket, head, websocket => {
      websocket.on("error", error => writeLog("warn", "collaboration.transport.failed", { requestId, code: "TRANSPORT_ERROR" }, error));
      access.watch(websocket);
      const document = getYDoc(claims.room);
      const connection = protocolServerSocket(websocket, failure => writeLog("warn", "collaboration.message.rejected", { requestId, code: failure.code }), {
        readOnly: claims.role === "VIEWER" || ephemeralDocument(claims.filePath),
        validatePresence: claims.filePath === PROJECT_PRESENCE_PATH ? createFollowPresenceValidator(claims,
          id => Array.from(document.conns).some(([socket, owned]) => socket !== connection && owned.has(id))) : claims.filePath === PROJECT_RUNTIME_PATH ? createRuntimePresenceValidator(claims,
          id => Array.from(document.conns).some(([socket, owned]) => socket !== connection && owned.has(id))) : undefined,
        validateAccess: access.assertValid,
        authorize: testMode ? undefined : () => access.check(),
        onMeasured: diagnosticsEnabled ? sample => { processing.record(sample.processingMs); authorization.record(sample.authorizationMs); } : undefined,
      });
      // Upstream tracks only newly added awareness IDs. A reconnect retains
      // its client ID and arrives as "updated", so claim that ID on this
      // connection as well to remove it immediately on the next close.
      const trackPresence = ({ added, updated, removed }, origin) => {
        if (origin !== connection) return;
        const owned = document.conns.get(connection);
        if (!owned) return;
        added.concat(updated).forEach(id => { if (document.awareness.getStates().has(id)) owned.add(id); });
        removed.forEach(id => owned.delete(id));
      };
      document.awareness.on("update", trackPresence);
      websocket.once("close", () => document.awareness.off("update", trackPresence));
      setupWSConnection(connection, request, { docName: claims.room });
    });
  } catch (error) {
    const code = error instanceof CollaborationProtocolError ? error.code : error?.code?.startsWith("ERR_JWT") || error?.code?.startsWith("ERR_JWS") ? "UNAUTHORIZED" : "UNAVAILABLE";
    const status = code === "VERSION_MISMATCH" ? 426 : code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "UNAVAILABLE" ? 503 : 400;
    writeLog("warn", "collaboration.connection.rejected", { requestId, code }, error);
    const body = JSON.stringify(protocolErrorResponse(code));
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nx-request-id: ${requestId}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  }
});

async function seedRoom(room, playgroundId, filePath, revision) {
  const document = getYDoc(room);
  if (!ephemeralDocument(filePath)) document.on("update", (update, origin) => {
    if (origin !== "persistence") schedulePersist(room);
    if (redisBridge && origin !== redisOrigin) {
      void redisBridge.publish({ ...roomMetadata.get(room), room, type: "update", data: Buffer.from(update).toString("base64") })
        .catch(error => writeLog("error", "collaboration.publish.failed", { code: "UPDATE_FAILED" }, error));
    }
  });
  document.awareness.on("update", ({ added, updated, removed }, origin) => {
    if (!redisBridge || origin === redisOrigin) return;
    const changedClients = added.concat(updated, removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(document.awareness, changedClients);
    void redisBridge.publish({ ...roomMetadata.get(room), room, type: "awareness", data: Buffer.from(update).toString("base64") })
      .catch(error => writeLog("error", "collaboration.publish.failed", { code: "AWARENESS_FAILED" }, error));
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
  if (ephemeralDocument(filePath)) return;
  // Always merge the checkpoint, including when Redis delivered live edits
  // during subscription. Nonempty text does not mean hydration is complete.
  const url = new URL("/api/collaboration/snapshot", appUrl);
  url.searchParams.set("playgroundId", playgroundId);
  url.searchParams.set("filePath", filePath);
  url.searchParams.set("room", room);
  url.searchParams.set("revision", String(revision));
  url.searchParams.set("protocolVersion", String(PROTOCOL_VERSION));
  const requestId = randomUUID();
  const response = await fetch(url, { headers: { "x-collaboration-secret": secret, "x-request-id": requestId }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    writeLog("error", "collaboration.snapshot.failed", { requestId, httpStatus: response.status, code: "LOAD_FAILED" });
    throw new Error("Unable to initialize collaboration room");
  }
  const result = snapshotResponseSchema.parse(await response.json());
  assertRoom(result.data);
  if (result.data.room !== room) throw new CollaborationProtocolError("ROOM_MISMATCH");
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
    void persistRoom(room).catch(error => writeLog("error", "collaboration.persistence.failed", { code: "SAVE_FAILED" }, error));
  }, 1500));
}

async function persistRoom(room) {
  persistTimers.delete(room);
  const metadata = roomMetadata.get(room);
  if (!metadata || ephemeralDocument(metadata.filePath)) return;
  const document = getYDoc(room);
  const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
  const requestId = randomUUID();
  const response = await fetch(new URL("/api/collaboration/snapshot", appUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-collaboration-secret": secret, "x-request-id": requestId },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ room, state, protocolVersion: PROTOCOL_VERSION, playgroundId: metadata.playgroundId, filePath: metadata.filePath, revision: metadata.revision }),
  });
  if (!response.ok) {
    writeLog("error", "collaboration.snapshot.failed", { requestId, httpStatus: response.status, code: "SAVE_FAILED" });
    throw new Error("Unable to persist collaboration room");
  }
  snapshotAckSchema.parse(await response.json());
}

async function start() {
  redisBridge = await createCollaborationRedisBridge({
    url: redisUrl,
    instanceId,
    onError: (_message, error) => writeLog("error", "collaboration.redis.failed", { dependency: "redis" }, error),
  });
  server.listen(port, host, () => writeLog("info", "collaboration.started"));
}
try { await start(); } catch (error) {
  writeLog("error", "collaboration.startup.failed", { code: "DEPENDENCY_FAILED" }, error);
  process.exit(1);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled(Array.from(roomMetadata.keys(), room => persistRoom(room)));
  websocketServer.clients.forEach(client => client.close(1001, "Server shutting down"));
  await redisBridge?.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { SignJWT, jwtVerify } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { createProtocolWebSocket } from "../lib/collaboration-websocket.mjs";
import { collaborationRoom, PROTOCOL_VERSION } from "../lib/collaboration-protocol.mjs";
import { TimingWindow, serverDiagnosticsSchema } from "../lib/collaboration-metrics.mjs";

const baseline = "REMOVE|BASE|";
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function eventually(check, label, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) { if (performance.now() >= deadline) throw new Error(`${label} deadline`); await pause(10); }
}
async function listen(server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return server.address().port;
}
function vectors(doc) { return JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(doc))].sort((a, b) => a[0] - b[0])); }
function assert(condition, message) { if (!condition) throw new Error(message); }

/** Isolated real service, real sockets, deterministic edit schedule, fixture authority. */
export async function runCollaborationPerformance(clientCounts = [2, 5, 10]) {
  const results = [];
  for (const count of clientCounts) results.push(await scenario(count));
  return { environment: { transport: "loopback WebSocket", authority: "local authenticated HTTP fixture", database: "fixture checkpoints", redis: false,
    node: process.version, platform: process.platform, sampleWindow: 256, rounds: 5 }, scenarios: results };
}

async function scenario(count) {
  assert([2, 5, 10].includes(count), "Supported client counts are 2, 5, 10");
  const secret = "performance-fixture-private-secret";
  const key = new TextEncoder().encode(secret);
  const playgroundId = `performance-${count}`;
  const filePath = "src/App.tsx";
  const room = collaborationRoom(playgroundId, filePath, 1);
  const identity = { protocolVersion: PROTOCOL_VERSION, playgroundId, filePath, revision: 1, room };
  let checkpoint;
  const app = http.createServer(async (request, response) => {
    if (request.headers["x-collaboration-secret"] !== secret) { response.writeHead(401).end(); return; }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/collaboration/access") {
      try {
        const { payload } = await jwtVerify(String(request.headers.authorization || "").slice(7), key);
        if (payload.room !== room || payload.role !== "EDITOR") throw new Error("Invalid access");
        response.end(JSON.stringify({ success: true, data: { ...identity, role: "EDITOR" } }));
      } catch { response.writeHead(403).end(); }
      return;
    }
    if (!request.url?.startsWith("/api/collaboration/snapshot")) { response.writeHead(404).end(); return; }
    if (request.method === "POST") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      checkpoint = JSON.parse(Buffer.concat(chunks).toString()).state;
      response.end(JSON.stringify({ success: true, protocolVersion: PROTOCOL_VERSION }));
    } else response.end(JSON.stringify({ success: true, data: { ...identity, ...(checkpoint ? { state: checkpoint } : { content: baseline }) } }));
  });
  const appPort = await listen(app);
  const reservation = http.createServer(); const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true,
    env: { ...process.env, NODE_ENV: "development", ENABLE_MOCK_DB: "false", COLLABORATION_TEST_MODE: "false", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port),
      COLLABORATION_SECRET: secret, COLLABORATION_APP_URL: `http://127.0.0.1:${appPort}`, NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" } });
  let logs = ""; let spawnError;
  child.stdout.on("data", chunk => { logs += chunk.toString(); }); child.stderr.on("data", chunk => { logs += chunk.toString(); });
  child.once("error", error => { spawnError = error; });
  const documents = []; const providers = []; const timings = []; const ping = new TimingWindow(); const convergence = new TimingWindow();
  const oracle = new Y.Doc();
  const diagnosticsUrl = `http://127.0.0.1:${port}/diagnostics`;
  async function diagnostics() {
    const response = await fetch(diagnosticsUrl, { headers: { "x-collaboration-secret": secret }, signal: AbortSignal.timeout(2000) });
    assert(response.ok, "Diagnostics response"); return serverDiagnosticsSchema.parse(await response.json());
  }
  function equal() {
    const text = documents[0].getText("content").toString(); const vector = vectors(documents[0]);
    return documents.every(doc => doc.getText("content").toString() === text && vectors(doc) === vector);
  }
  try {
    await eventually(() => { if (spawnError || child.exitCode !== null) throw new Error("Performance service startup failed"); return logs.includes("collaboration.started"); }, "Startup", 30_000);
    assert((await fetch(diagnosticsUrl)).status === 401, "Diagnostics must require service authentication");
    for (let index = 0; index < count; index++) {
      const doc = new Y.Doc(); doc.clientID = 1000 + index; documents.push(doc);
      const timing = new TimingWindow(); timings.push(timing);
      const token = await new SignJWT({ ...identity, role: "EDITOR", scope: "collaboration:write", userId: `client-${index}`, name: "Performance client", color: "#3b82f6" })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key);
      const provider = new WebsocketProvider(`ws://127.0.0.1:${port}`, room, doc, { disableBc: true,
        WebSocketPolyfill: createProtocolWebSocket(WebSocket, undefined, sample => timing.record(sample.applyMs)), params: { token } });
      providers.push(provider);
      await eventually(() => provider.synced && doc.getText("content").toString() === baseline, "Initial sync");
    }
    // Each round begins from equal state. All local transactions run in the
    // same task before network delivery, so every client contributes an edit.
    const markers = [];
    for (let round = 0; round < 5; round++) {
      const started = performance.now();
      documents.forEach((doc, index) => {
        const marker = `[r${round}c${index}]`; markers.push(marker);
        doc.getText("content").insert(0, marker);
      });
      await eventually(equal, "Concurrent convergence"); convergence.record(performance.now() - started);
      for (const marker of markers) assert(documents[0].getText("content").toString().split(marker).length === 2, "Missing or duplicated concurrent edit");
    }
    // A controlled offline barrier creates overlapping deletes plus unique
    // insertions. Merge an independent oracle in reverse client order.
    providers.forEach(provider => provider.disconnect());
    await eventually(() => providers.every(provider => provider.ws === null), "Disconnect");
    documents.forEach((doc, index) => doc.transact(() => {
      const text = doc.getText("content"); text.delete(text.toString().indexOf("REMOVE|"), 7); text.insert(text.length, `[offline${index}]`);
    }));
    [...documents].reverse().forEach(doc => Y.applyUpdate(oracle, Y.encodeStateAsUpdate(doc)));
    const expected = oracle.getText("content").toString();
    providers.forEach(provider => provider.connect());
    await eventually(() => providers.every(provider => provider.synced) && equal() && documents.every(doc => doc.getText("content").toString() === expected), "Offline recovery");
    assert(!expected.includes("REMOVE|") && expected.includes("BASE|"), "Concurrent deletion lost");
    markers.push(...documents.map((_doc, index) => `[offline${index}]`));
    for (const marker of markers) assert(expected.split(marker).length === 2, "Missing or duplicated recovered edit");
    const expectedLength = baseline.length - 7 + markers.reduce((sum, marker) => sum + marker.length, 0);
    assert(expected.length === expectedLength, "Unexpected final document length");
    // WS ping/pong is a control-path RTT. It does not acknowledge a Yjs edit.
    for (const provider of providers) {
      for (let sample = 0; sample < 5; sample++) {
        const started = performance.now(); const socket = provider.ws;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { socket.off("pong", pong); reject(new Error("Ping deadline")); }, 2000);
          const pong = () => { clearTimeout(timeout); ping.record(performance.now() - started); resolve(); };
          socket.once("pong", pong); socket.ping();
        });
      }
    }
    const server = await diagnostics();
    assert(server.activeSockets === count, "Duplicate or missing active sockets");
    assert(server.processing.samples > 0 && server.authorization.samples > 0, "Missing server timing samples");
    assert(!logs.includes(secret) && !logs.includes("Yjs was already imported") && !logs.includes("collaboration.message.rejected"), "Unsafe logs or rejected performance traffic");
    return { clients: count, concurrentEdits: count * 5, offlineEdits: count, converged: true, lostUpdates: 0, finalCharacters: expected.length,
      serverProcessing: server.processing, authorization: server.authorization, networkRoundTrip: ping.snapshot(),
      clientApplication: timings.map(timing => timing.snapshot()), roundConvergence: convergence.snapshot() };
  } finally {
    providers.forEach(provider => provider.destroy()); documents.forEach(doc => doc.destroy()); oracle.destroy();
    if (child.exitCode === null && !spawnError) { const exited = once(child, "exit"); child.kill(); await exited; }
    app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
  }
}

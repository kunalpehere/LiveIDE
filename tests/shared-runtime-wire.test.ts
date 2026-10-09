import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { PresenceWebsocketProvider } from "@/lib/collaboration-presence";
import { createProtocolWebSocket } from "@/lib/collaboration-websocket.mjs";
import { collaborationRoom, PROJECT_RUNTIME_PATH, WEBSOCKET_PROTOCOL, encodeFrame } from "@/lib/collaboration-protocol.mjs";

async function until(check: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Runtime wire deadline"); await new Promise(resolve => setTimeout(resolve, 30)); }
}
it("relays authenticated runtime awareness, rejects document writes and raw logs, and never checkpoints runtime state", async () => {
  const secret = "runtime-wire-local-secret", key = new TextEncoder().encode(secret);
  let snapshots = 0;
  const fixture = http.createServer(async (request, response) => {
    if (request.url !== "/api/collaboration/access") { snapshots++; response.writeHead(500).end(); return; }
    const { payload } = await jwtVerify(String(request.headers.authorization).slice(7), key);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: PROJECT_RUNTIME_PATH, room: payload.room, revision: 1, role: payload.role } }));
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  const appPort = (fixture.address() as { port: number }).port;
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const room = collaborationRoom("project", PROJECT_RUNTIME_PATH);
  const token = (role: "EDITOR" | "VIEWER") => new SignJWT({ protocolVersion: 1, playgroundId: "project", filePath: PROJECT_RUNTIME_PATH, revision: 1, room, role, scope: role === "VIEWER" ? "collaboration:read" : "collaboration:write", userId: role, name: role, color: "#112233" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const providers: PresenceWebsocketProvider[] = [], docs: Y.Doc[] = [], sockets: WebSocket[] = [];
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true, env: { ...process.env, NODE_ENV: "development", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port), COLLABORATION_APP_URL: `http://127.0.0.1:${appPort}`, COLLABORATION_SECRET: secret, COLLABORATION_TEST_MODE: "false", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" } });
  let started = false; child.stdout?.on("data", bytes => { if (bytes.toString().includes("collaboration.started")) started = true; });
  async function connect(role: "EDITOR" | "VIEWER") {
    const doc = new Y.Doc(); docs.push(doc);
    const provider = new PresenceWebsocketProvider(`ws://127.0.0.1:${port}`, room, doc, { connect: false, disableBc: true, WebSocketPolyfill: createProtocolWebSocket(WebSocket as unknown as typeof globalThis.WebSocket), params: { token: await token(role) } });
    providers.push(provider);
    provider.awareness.setLocalState({ user: { id: role, name: role, color: "#112233" }, runtime: { nonce: crypto.randomUUID(), phase: role === "EDITOR" ? "ready" : "idle", previewReady: role === "EDITOR", controls: false, logs: role === "EDITOR" ? [{ sequence: 1, event: "ready" }] : [] }, request: null, ack: null });
    provider.connect(); await until(() => provider.synced); return { doc, provider };
  }
  try {
    await until(() => started);
    const host = await connect("EDITOR"), viewer = await connect("VIEWER");
    await until(() => viewer.provider.awareness.getStates().has(host.doc.clientID));
    expect(viewer.provider.awareness.getStates().get(host.doc.clientID)?.runtime.phase).toBe("ready");
    for (const role of ["EDITOR", "VIEWER"] as const) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/${room}?token=${await token(role)}`, WEBSOCKET_PROTOCOL); sockets.push(socket); socket.on("error", () => {}); await once(socket, "open");
      const attack = new Y.Doc(); attack.getText("content").insert(0, "forbidden shared shell");
      const frame = encoding.createEncoder(); encoding.writeVarUint(frame, 0); encoding.writeVarUint(frame, 2); encoding.writeVarUint8Array(frame, Y.encodeStateAsUpdate(attack)); attack.destroy();
      const closed = once(socket, "close"); socket.send(encodeFrame(encoding.toUint8Array(frame))); expect((await closed)[0]).toBe(1008);
    }
    const closed = new Promise<number>(resolve => host.provider.on("connection-close", (event: CloseEvent) => resolve(event.code)));
    host.provider.shouldConnect = false;
    host.provider.awareness.setLocalStateField("runtime", { ...host.provider.awareness.getLocalState()?.runtime, logs: [{ sequence: 2, event: "output", text: "SECRET=value" }] });
    expect(await closed).toBe(1002);
    expect(snapshots).toBe(0);
  } finally {
    providers.forEach(provider => provider.destroy()); docs.forEach(doc => doc.destroy()); sockets.forEach(socket => socket.terminate());
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}, 60_000);

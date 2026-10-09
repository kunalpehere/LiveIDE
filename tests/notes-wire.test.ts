import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { PresenceWebsocketProvider } from "@/lib/collaboration-presence";
import { createProtocolWebSocket } from "@/lib/collaboration-websocket.mjs";
import { collaborationRoom, PROJECT_NOTES_PATH, WEBSOCKET_PROTOCOL, encodeFrame } from "@/lib/collaboration-protocol.mjs";

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15_000;
  while (!await check()) { if (Date.now() > deadline) throw new Error("Notes convergence deadline"); await new Promise(resolve => setTimeout(resolve, 30)); }
}
it("converges isolated notes, merges offline edits, rejects viewer writes, and hydrates after a real service restart", async () => {
  const secret = "notes-wire-local-only-secret", key = new TextEncoder().encode(secret);
  const checkpoints = new Map<string, string>();
  const fixture = http.createServer(async (request, response) => {
    if (request.headers["x-collaboration-secret"] !== secret) { response.writeHead(401).end(); return; }
    if (request.url === "/api/collaboration/access") {
      const { payload } = await jwtVerify(String(request.headers.authorization).slice(7), key);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: payload.filePath, room: payload.room, revision: 1, role: payload.role } })); return;
    }
    if (request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); checkpoints.set(body.room, body.state);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, protocolVersion: 1 })); return;
    }
    const query = new URL(request.url!, "http://fixture").searchParams;
    const room = query.get("room")!, filePath = query.get("filePath")!;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath, room, revision: 1,
      ...(checkpoints.has(room) ? { state: checkpoints.get(room) } : { content: filePath === PROJECT_NOTES_PATH ? "" : "source baseline" }) } }));
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  const appPort = (fixture.address() as { port: number }).port;
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ChildProcess | undefined;
  const providers: PresenceWebsocketProvider[] = [], docs: Y.Doc[] = [], sockets: WebSocket[] = [];
  async function start() {
    let logs = "";
    child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true, env: { ...process.env, NODE_ENV: "development", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port), COLLABORATION_APP_URL: `http://127.0.0.1:${appPort}`, COLLABORATION_SECRET: secret, COLLABORATION_TEST_MODE: "false", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" } });
    child.stdout?.on("data", bytes => { logs += bytes.toString(); }); child.stderr?.on("data", bytes => { logs += bytes.toString(); });
    await until(() => logs.includes("collaboration.started"));
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, "exit"); child.kill("SIGTERM"); await exit; child = undefined;
  }
  const token = (role: "EDITOR" | "VIEWER", filePath = PROJECT_NOTES_PATH) => new SignJWT({ protocolVersion: 1, playgroundId: "project", filePath, revision: 1, room: collaborationRoom("project", filePath), role, scope: role === "VIEWER" ? "collaboration:read" : "collaboration:write", userId: role, name: role, color: "#112233" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  async function connect(role: "EDITOR" | "VIEWER", filePath = PROJECT_NOTES_PATH) {
    const doc = new Y.Doc(); docs.push(doc);
    const provider = new PresenceWebsocketProvider(`ws://127.0.0.1:${port}`, collaborationRoom("project", filePath), doc, { connect: false, disableBc: true, WebSocketPolyfill: createProtocolWebSocket(WebSocket as unknown as typeof globalThis.WebSocket), params: { token: await token(role, filePath) } });
    providers.push(provider); provider.connect(); await until(() => provider.synced); return { doc, provider, text: doc.getText("content") };
  }
  try {
    await start();
    const first = await connect("EDITOR"), second = await connect("EDITOR"), viewer = await connect("VIEWER");
    const source = await connect("EDITOR", "src/App.tsx");
    first.text.insert(0, "owner decision\n"); second.text.insert(0, "editor plan\n");
    await until(() => first.text.toString().includes("editor plan") && second.text.toString() === first.text.toString() && viewer.text.toString() === first.text.toString());
    expect(source.text.toString()).toBe("source baseline");
    first.provider.disconnect(); first.text.insert(first.text.length, "offline draft\n"); second.text.insert(second.text.length, "online change\n");
    first.provider.connect(); await until(() => first.provider.synced && first.text.toString().includes("online change") && second.text.toString().includes("offline draft"));
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${collaborationRoom("project", PROJECT_NOTES_PATH)}?token=${await token("VIEWER")}`, WEBSOCKET_PROTOCOL); sockets.push(socket); socket.on("error", () => {}); await once(socket, "open");
    const attack = new Y.Doc(); attack.getText("content").insert(0, "forbidden viewer write");
    const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); encoding.writeVarUint(encoder, 2); encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(attack)); attack.destroy();
    const closed = once(socket, "close"); socket.send(encodeFrame(encoding.toUint8Array(encoder))); expect((await closed)[0]).toBe(1008);
    const expected = first.text.toString(), room = collaborationRoom("project", PROJECT_NOTES_PATH);
    await until(() => {
      const state = checkpoints.get(room); if (!state) return false;
      const stored = new Y.Doc(); Y.applyUpdate(stored, Buffer.from(state, "base64")); const equal = stored.getText("content").toString() === expected; stored.destroy(); return equal;
    });
    providers.forEach(provider => provider.destroy()); await stop(); await start();
    const reopened = await connect("VIEWER"); expect(reopened.text.toString()).toBe(expected); expect(reopened.text.toString()).not.toContain("forbidden viewer write");
    expect((await connect("EDITOR", "src/App.tsx")).text.toString()).toBe("source baseline");
  } finally { providers.forEach(provider => provider.destroy()); docs.forEach(doc => doc.destroy()); sockets.forEach(socket => socket.terminate()); await stop(); await new Promise<void>(resolve => fixture.close(() => resolve())); }
}, 90_000);

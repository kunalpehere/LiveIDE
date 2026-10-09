import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { WebsocketProvider } from "y-websocket";
import { createProtocolWebSocket } from "@/lib/collaboration-websocket.mjs";
import { PresenceWebsocketProvider } from "@/lib/collaboration-presence";
import { collaborationRoom, encodeFrame, WEBSOCKET_PROTOCOL, PROJECT_PRESENCE_PATH } from "@/lib/collaboration-protocol.mjs";

async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Authorization deadline"); await new Promise(resolve => setTimeout(resolve, 20)); }
}

it("enforces viewer read-only, live revocation, expiry, restored revisions, and authority failure on real sockets", async () => {
  const secret = "authorization-wire-test-secret";
  const key = new TextEncoder().encode(secret);
  let role: "EDITOR" | "VIEWER" | null = "EDITOR"; let revision = 1; let unavailable = false;
  const acceptedWrites: number[] = [];
  const fixture = http.createServer(async (request, response) => {
    if (request.headers["x-collaboration-secret"] !== secret) { response.writeHead(401).end(); return; }
    if (request.url === "/api/collaboration/access") {
      if (unavailable) { response.writeHead(503).end(); return; }
      const { payload } = await jwtVerify(String(request.headers.authorization).slice(7), key);
      if (payload.revision !== revision) { response.writeHead(409).end(); return; }
      if (payload.userId === "editor" && role !== payload.role) { response.writeHead(403).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: payload.filePath, room: payload.room, revision, role: payload.role } })); return;
    }
    if (request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (data.revision !== revision) { response.writeHead(409).end(); return; }
      acceptedWrites.push(data.revision); response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, protocolVersion: 1 })); return;
    }
    const query = new URL(request.url!, "http://fixture").searchParams;
    if (Number(query.get("revision")) !== revision) { response.writeHead(409).end(); return; }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: "src/App.tsx", room: query.get("room"), revision, content: revision === 1 ? "baseline" : "restored" } }));
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  const appAddress = fixture.address() as { port: number };
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true, env: { ...process.env, NODE_ENV: "development", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port), COLLABORATION_SECRET: secret, COLLABORATION_APP_URL: `http://127.0.0.1:${appAddress.port}`, COLLABORATION_TEST_MODE: "false", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" } });
  let logs = ""; child.stderr!.on("data", bytes => { logs += bytes.toString(); });
  const providers: WebsocketProvider[] = []; const documents: Y.Doc[] = []; const sockets: WebSocket[] = [];
  const token = (userRole: "EDITOR" | "VIEWER", userId: string, rev = revision, lifetime = 60, filePath = "src/App.tsx") => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ protocolVersion: 1, playgroundId: "project", filePath, room: collaborationRoom("project", filePath, rev), revision: rev, role: userRole,
      scope: userRole === "VIEWER" ? "collaboration:read" : "collaboration:write", userId, name: userId, color: "#112233" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(now).setExpirationTime(now + lifetime).sign(key);
  };
  async function connect(userRole: "EDITOR" | "VIEWER", userId: string, filePath = "src/App.tsx") {
    const doc = new Y.Doc(); documents.push(doc);
    const Provider = filePath === PROJECT_PRESENCE_PATH ? PresenceWebsocketProvider : WebsocketProvider;
    const provider = new Provider(`ws://127.0.0.1:${port}`, collaborationRoom("project", filePath, revision), doc, { disableBc: true, WebSocketPolyfill: createProtocolWebSocket(WebSocket as unknown as typeof globalThis.WebSocket), params: { token: await token(userRole, userId, revision, 60, filePath) } });
    if (filePath === PROJECT_PRESENCE_PATH) provider.awareness.setLocalState({ user: { id: userId, name: userId, color: "#112233" }, view: null, following: null });
    providers.push(provider); let closedCode: number | undefined;
    provider.on("connection-close", (event: CloseEvent) => { closedCode = event.code; provider.disconnect(); });
    if (filePath === PROJECT_PRESENCE_PATH) provider.connect();
    try { await until(() => provider.synced); } catch { throw new Error(`Room sync deadline (${filePath}, close ${closedCode}): ${logs}`); }
    return { doc, provider };
  }
  async function raw(accessToken: string, rev = revision, filePath = "src/App.tsx") {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${collaborationRoom("project", filePath, rev)}?token=${accessToken}`, WEBSOCKET_PROTOCOL); sockets.push(socket); socket.on("error", () => {}); await once(socket, "open"); return socket;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Service startup deadline")), 25_000);
      child.stdout!.on("data", bytes => { logs += bytes.toString(); if (logs.includes("collaboration.started")) { clearTimeout(timer); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Service exited")); });
    });
    const presenceEditor = await connect("EDITOR", "editor", PROJECT_PRESENCE_PATH);
    const presenceViewer = await connect("VIEWER", "viewer", PROJECT_PRESENCE_PATH);
    await until(() => presenceViewer.provider.awareness.getStates().has(presenceEditor.doc.clientID));
    expect(acceptedWrites).toEqual([]);
    const presenceAttack = new Y.Doc(); documents.push(presenceAttack); presenceAttack.getText("content").insert(0, "forbidden");
    const presenceSocket = await raw(await token("EDITOR", "editor", revision, 60, PROJECT_PRESENCE_PATH), revision, PROJECT_PRESENCE_PATH);
    const presenceClosed = once(presenceSocket, "close");
    const presenceEncoder = encoding.createEncoder(); encoding.writeVarUint(presenceEncoder, 0); encoding.writeVarUint(presenceEncoder, 2); encoding.writeVarUint8Array(presenceEncoder, Y.encodeStateAsUpdate(presenceAttack));
    presenceSocket.send(encodeFrame(encoding.toUint8Array(presenceEncoder)));
    expect((await presenceClosed)[0]).toBe(1008);
    expect(Array.from(presenceViewer.doc.share.keys())).toEqual([]);
    presenceEditor.provider.destroy(); presenceViewer.provider.destroy();
    const editor = await connect("EDITOR", "editor"); const viewer = await connect("VIEWER", "viewer");
    expect(viewer.doc.getText("content").toString()).toBe("baseline");
    editor.doc.getText("content").insert(0, "allowed"); await until(() => viewer.doc.getText("content").toString() === "allowedbaseline");
    const attack = new Y.Doc(); documents.push(attack); attack.getText("content").insert(0, "attack");
    for (const subtype of [1, 2]) {
      const socket = await raw(await token("VIEWER", "viewer")); const closed = once(socket, "close");
      const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); encoding.writeVarUint(encoder, subtype); encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(attack));
      socket.send(encodeFrame(encoding.toUint8Array(encoder))); expect((await closed)[0]).toBe(1008);
    }
    expect(editor.doc.getText("content").toString()).toBe("allowedbaseline");
    const revoked = new Promise<number>(resolve => editor.provider.on("connection-close", (event: CloseEvent) => resolve(event.code)));
    role = null; editor.doc.getText("content").insert(0, "revoked"); expect(await revoked).toBe(1008);
    expect(viewer.doc.getText("content").toString()).toBe("allowedbaseline");
    role = "EDITOR";
    const expired = await raw(await token("EDITOR", "editor", revision, 2)); expect((await once(expired, "close"))[0]).toBe(4001);
    const idle = await raw(await token("EDITOR", "editor")); const idleClosed = once(idle, "close"); role = "VIEWER";
    expect((await idleClosed)[0]).toBe(4003); role = "EDITOR";
    const stale = await connect("EDITOR", "editor"); const staleClosed = new Promise<number>(resolve => stale.provider.on("connection-close", (event: CloseEvent) => resolve(event.code)));
    revision = 2; const oldWrites = acceptedWrites.length; stale.doc.getText("content").insert(0, "old-revision"); expect(await staleClosed).toBe(4009);
    const restored = await connect("EDITOR", "editor"); expect(restored.doc.getText("content").toString()).toBe("restored");
    await new Promise(resolve => setTimeout(resolve, 1700)); expect(acceptedWrites.slice(oldWrites).every(value => value === 2)).toBe(true);
    unavailable = true;
    const failure = new Promise<number>(resolve => restored.provider.on("connection-close", (event: CloseEvent) => resolve(event.code)));
    restored.doc.getText("content").insert(0, "unvalidated"); expect(await failure).toBe(1013);
    expect(logs).not.toContain(secret);
  } finally {
    providers.forEach(provider => provider.destroy()); documents.forEach(doc => doc.destroy()); sockets.forEach(socket => socket.terminate());
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}, 60_000);

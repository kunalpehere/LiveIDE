import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { SignJWT } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import { CollaborationSession, type CollaborationStatus } from "@/lib/collaboration-session";
import { PRESENCE_INTERVAL_MS } from "@/lib/collaboration-presence";
import { collaborationRoom, decodeFrame } from "@/lib/collaboration-protocol.mjs";

async function eventually(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Recovery deadline");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it("recovers real sockets through offline edits and server restart with stable presence, and bounds rejected authentication", async () => {
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const address = reservation.address(); if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const secret = "day8-test-private-secret";
  const room = collaborationRoom("project", "src/App.tsx", 1);
  let child: ReturnType<typeof spawn> | undefined;
  let logs = "";
  async function startServer() {
    child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true, env: { ...process.env,
      NODE_ENV: "development", ENABLE_MOCK_DB: "false", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port),
      COLLABORATION_SECRET: secret, COLLABORATION_TEST_MODE: "true", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" } });
    const processHandle = child;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup deadline: ${logs}`)), 20_000);
      processHandle.stdout!.on("data", chunk => {
        logs += chunk.toString();
        if (chunk.toString().includes("collaboration.started")) { clearTimeout(timer); resolve(); }
      });
      processHandle.stderr!.on("data", chunk => { logs += chunk.toString(); });
      processHandle.once("error", error => { clearTimeout(timer); reject(error); });
      processHandle.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited")); });
    });
  }
  async function stopServer() {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  const documents = [new Y.Doc(), new Y.Doc()];
  const sessions: CollaborationSession[] = [];
  const sockets: WebSocket[] = [];
  const presenceFrames: Uint8Array[] = [];
  class TrackedSocket extends WebSocket {
    constructor(url: string | URL, protocol?: string | string[]) {
      super(url, protocol); sockets.push(this);
      this.on("error", () => {});
      this.on("message", bytes => {
        const message = decodeFrame(bytes);
        if (message.type === "awareness") presenceFrames.push(message.payload);
      });
    }
  }
  async function sessionData(index: number, expired = false) {
    const identity = { protocolVersion: 1 as const, role: "EDITOR" as const, playgroundId: "project", filePath: "src/App.tsx", room, revision: 1 };
    const user = { id: `user-${index}`, name: `User ${index}`, color: "#112233" };
    const token = await new SignJWT({ ...identity, userId: user.id, name: user.name, color: user.color, scope: "collaboration:write" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 10 : "2m").sign(new TextEncoder().encode(secret));
    return { ...identity, user, token, websocketUrl: `ws://127.0.0.1:${port}` };
  }
  const states: CollaborationStatus[][] = [[], []];
  const network = new EventTarget(); let online = true;
  try {
    await startServer();
    for (let index = 0; index < 2; index++) {
      const session = new CollaborationSession({ document: documents[index], getToken: () => sessionData(index),
        WebSocket: TrackedSocket as unknown as typeof globalThis.WebSocket,
        onState: state => states[index].push(state), onSynced: () => {},
        networkEvents: index === 1 ? network : undefined, isOnline: () => index === 0 || online,
        policy: { baseDelayMs: 50, maxDelayMs: 200, maxAttempts: 40, attemptTimeoutMs: 2000 } });
      sessions.push(session); session.start(); session.start();
    }
    const connected = () => states.every(values => values.at(-1) === "connected");
    const presence = () => sessions.slice(0, 2).every(session => session.awareness.getStates().size === 2);
    try { await eventually(() => connected() && presence()); }
    catch (error) { throw new Error(`Initial sync failed: ${JSON.stringify({ states, presence: sessions.map(session => Array.from(session.awareness.getStates().keys())), sockets: sockets.map(socket => socket.readyState), logs })}`, { cause: error }); }
    const ids = documents.map(doc => doc.clientID);
    documents[0].getText("content").insert(0, "baseline");
    await eventually(() => documents[1].getText("content").toString() === "baseline");
    presenceFrames.length = 0;
    const durableBefore = Y.encodeStateAsUpdate(documents[0]);
    const burstStarted = Date.now();
    for (let index = 0; index < 1000; index++) sessions[0].awareness.setLocalStateField("selection", {
      anchor: Y.createRelativePositionFromTypeIndex(documents[0].getText("content"), index % 9),
      head: Y.createRelativePositionFromTypeIndex(documents[0].getText("content"), index % 9), sequence: index,
    });
    const expectedBroadcastLimit = 2 * (Math.floor((Date.now() - burstStarted) / PRESENCE_INTERVAL_MS) + 2);
    await eventually(() => sessions[1].awareness.getStates().get(ids[0])?.selection?.sequence === 999);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(presenceFrames.length).toBeLessThanOrEqual(expectedBroadcastLimit);
    expect(presenceFrames.length).toBeGreaterThan(0);
    expect(Y.encodeStateAsUpdate(documents[0])).toEqual(durableBefore);
    expect(sessions[1].awareness.getStates().get(ids[0])?.activeFile).toBe("src/App.tsx");
    online = false; network.dispatchEvent(new Event("offline")); network.dispatchEvent(new Event("offline"));
    expect(states[1].at(-1)).toBe("offline");
    documents[1].getText("content").insert(0, "offline"); documents[0].getText("content").insert(0, "online");
    online = true; network.dispatchEvent(new Event("online")); network.dispatchEvent(new Event("online"));
    try { await eventually(() => connected() && presence() && documents[0].getText("content").toString() === documents[1].getText("content").toString()); }
    catch (error) { throw new Error(`Offline recovery failed: ${JSON.stringify({ states, presence: sessions.map(session => Array.from(session.awareness.getStates().keys())), content: documents.map(doc => doc.getText("content").toString()), sockets: sockets.map(socket => socket.readyState), logs })}`, { cause: error }); }
    const beforeRestart = documents[0].getText("content").toString();
    expect(beforeRestart.match(/offline/g)).toHaveLength(1); expect(beforeRestart.match(/online/g)).toHaveLength(1);
    expect(sockets.filter(socket => socket.readyState === WebSocket.OPEN)).toHaveLength(2);
    // Returning IDs are awareness "updated" events, not newly "added" IDs.
    // The replacement socket must own them for immediate subsequent cleanup.
    online = false; network.dispatchEvent(new Event("offline"));
    await eventually(() => sessions[0].awareness.getStates().size === 1);
    online = true; network.dispatchEvent(new Event("online"));
    await eventually(() => connected() && presence());

    await stopServer();
    await eventually(() => states.every(values => values.at(-1) === "reconnecting"));
    documents[0].getText("content").insert(0, "restart");
    await startServer();
    await eventually(() => connected() && presence() && documents[0].getText("content").toString() === documents[1].getText("content").toString());
    expect(documents[1].getText("content").toString()).toBe(`restart${beforeRestart}`);
    expect(documents.map(doc => doc.clientID)).toEqual(ids);
    expect(sessions.slice(0, 2).every(session => Array.from(session.awareness.getStates().keys()).sort().join() === [...ids].sort().join())).toBe(true);
    expect(sockets.filter(socket => socket.readyState === WebSocket.OPEN)).toHaveLength(2);
    expect(documents.every(doc => doc._observers.get("update")?.size === 1)).toBe(true);

    const rejectedDoc = new Y.Doc(); documents.push(rejectedDoc);
    let requests = 0; let rejectedState: CollaborationStatus | undefined;
    const rejected = new CollaborationSession({ document: rejectedDoc, getToken: () => { requests++; return sessionData(2, true); },
      WebSocket: TrackedSocket as unknown as typeof globalThis.WebSocket, onState: state => { rejectedState = state; }, onSynced: () => {},
      policy: { maxAttempts: 2, baseDelayMs: 20, attemptTimeoutMs: 1000 } });
    sessions.push(rejected); rejected.start();
    await eventually(() => rejectedState === "failed");
    await new Promise(resolve => setTimeout(resolve, 200)); expect(requests).toBe(2);
    expect(sockets.filter(socket => socket.readyState === WebSocket.OPEN)).toHaveLength(2);
    const departedId = documents[1].clientID;
    sessions[1].dispose();
    await eventually(() => sessions[0].awareness.getStates().size === 1);
    expect(sessions[0].awareness.getStates().has(departedId)).toBe(false);
    expect(logs).not.toContain(secret); expect(logs).not.toContain("Yjs was already imported");
    sessions.forEach(session => session.dispose());
    expect(documents.every(doc => !doc._observers.get("update")?.size)).toBe(true);
  } finally {
    sessions.forEach(session => session.dispose()); documents.forEach(doc => doc.destroy());
    sockets.forEach(socket => socket.terminate()); await stopServer();
  }
}, 40_000);

import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { SignJWT } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { createProtocolWebSocket } from "@/lib/collaboration-websocket.mjs";
import { collaborationRoom, PROTOCOL_VERSION, WEBSOCKET_PROTOCOL, decodeFrame, validateYjsMessage } from "@/lib/collaboration-protocol.mjs";

async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Convergence deadline");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it("validates versioned transport and synchronizes incremental edits, offline recovery, and deletions without echoes", async () => {
  const temporary = http.createServer(); temporary.listen(0, "127.0.0.1"); await once(temporary, "listening");
  const address = temporary.address(); if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port; await new Promise<void>(resolve => temporary.close(() => resolve()));
  const secret = "wire-integration-private-secret";
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true,
    env: { ...process.env, NODE_ENV: "development", ENABLE_MOCK_DB: "false", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port), COLLABORATION_SECRET: secret,
      COLLABORATION_TEST_MODE: "true", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" },
  });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); }); child.stderr.on("data", chunk => { logs += chunk.toString(); });
  const room = collaborationRoom("project-1", "src/App.tsx", 1);
  const url = `ws://127.0.0.1:${port}`;
  const documents: Y.Doc[] = []; const providers: WebsocketProvider[] = []; const sockets: WebSocket[] = [];
  const token = (changes: Record<string, unknown> = {}) => new SignJWT({ protocolVersion: PROTOCOL_VERSION, role: "EDITOR", scope: "collaboration:write", playgroundId: "project-1", filePath: "src/App.tsx", room, revision: 1, userId: "user-1", name: "One", color: "#3b82f6", ...changes })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2m").sign(new TextEncoder().encode(secret));
  async function rejectedHandshake(accessToken: string, protocol?: string) {
    const socket = new WebSocket(`${url}/${room}?token=${accessToken}`, protocol); sockets.push(socket);
    socket.on("error", () => {});
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Expected rejected handshake")); }, 5000);
      socket.on("unexpected-response", (_request, response) => {
        let raw = ""; response.on("data", chunk => { raw += chunk.toString(); });
        response.on("end", () => { clearTimeout(timeout); socket.terminate(); resolve({ status: response.statusCode!, body: JSON.parse(raw) }); });
      });
      socket.on("open", () => { clearTimeout(timeout); reject(new Error("Unexpected accepted handshake")); });
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Startup deadline")), 20_000);
      child.stdout.on("data", chunk => { if (chunk.toString().includes("collaboration.started")) { clearTimeout(timer); resolve(); } });
      child.once("error", error => { clearTimeout(timer); reject(error); });
    });
    const goodToken = await token();
    expect(await rejectedHandshake(goodToken)).toMatchObject({ status: 426, body: { error: { code: "VERSION_MISMATCH" } } });
    expect(await rejectedHandshake(await token({ protocolVersion: 2 }), WEBSOCKET_PROTOCOL)).toMatchObject({ status: 426, body: { error: { code: "VERSION_MISMATCH" } } });
    expect(await rejectedHandshake(await token({ role: "VIEWER" }), WEBSOCKET_PROTOCOL)).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    expect(await rejectedHandshake(await token({ revision: 2 }), WEBSOCKET_PROTOCOL)).toMatchObject({ status: 400, body: { error: { code: "ROOM_MISMATCH" } } });

    for (const data of ["bad text", new Uint8Array([76,73,68,69,2,0]), new Uint8Array([76,73,68,69,1,99])]) {
      const socket = new WebSocket(`${url}/${room}?token=${goodToken}`, WEBSOCKET_PROTOCOL); sockets.push(socket);
      socket.on("error", () => {});
      await once(socket, "open");
      expect(socket.protocol).toBe(WEBSOCKET_PROTOCOL);
      const closed = once(socket, "close"); socket.send(data);
      const [code, reason] = await closed;
      expect(code).toBe(1002);
      expect(reason.toString()).toBe(typeof data !== "string" && data[4] === 2 ? "VERSION_MISMATCH" : "MALFORMED_MESSAGE");
    }

    const ProtocolSocket = createProtocolWebSocket(WebSocket as unknown as typeof globalThis.WebSocket);
    const oversized = new WebSocket(`${url}/${room}?token=${goodToken}`, WEBSOCKET_PROTOCOL); sockets.push(oversized);
    oversized.on("error", () => {});
    await once(oversized, "open"); const oversizedClosed = once(oversized, "close");
    oversized.send(new Uint8Array(1024 * 1024 + 1));
    expect((await oversizedClosed)[0]).toBe(1009);
    const traffic: { incoming: ReturnType<typeof decodeFrame>[]; outgoing: ReturnType<typeof validateYjsMessage>[] }[] = [];
    for (let index = 0; index < 2; index++) {
      const frames: typeof traffic[number] = { incoming: [], outgoing: [] }; traffic.push(frames);
      class MeasuredSocket extends ProtocolSocket {
        constructor(address: string | URL) {
          super(address);
          this.addEventListener("message", event => frames.incoming.push(decodeFrame(event.data)));
        }
        send(data: Parameters<InstanceType<typeof ProtocolSocket>["send"]>[0]) {
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
          if (!bytes) throw new Error("Expected binary frame");
          frames.outgoing.push(validateYjsMessage(bytes)); super.send(data);
        }
      }
      const doc = new Y.Doc(); documents.push(doc);
      const provider = new WebsocketProvider(url, room, doc, { disableBc: true, WebSocketPolyfill: MeasuredSocket, params: { token: goodToken } }); providers.push(provider);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Sync deadline")), 5000);
        provider.on("sync", (synced: boolean) => { if (synced) { clearTimeout(timer); resolve(); } });
      });
    }
    documents[0].getText("content").insert(0, "alpha"); documents[1].getText("content").insert(0, "beta");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Convergence deadline")), 5000);
      const check = () => {
        const value = documents[0].getText("content").toString();
        if (value.includes("alpha") && value.includes("beta") && value === documents[1].getText("content").toString()) { clearTimeout(timer); resolve(); }
      };
      documents.forEach(doc => doc.on("update", check)); check();
    });
    expect(providers.every(provider => provider.synced)).toBe(true);

    // A large common baseline makes full-state resends easy to distinguish.
    const baseline = "x".repeat(64 * 1024);
    documents[0].getText("content").insert(0, baseline);
    await eventually(() => documents[0].getText("content").toString() === documents[1].getText("content").toString());
    traffic.forEach(frames => { frames.incoming.length = 0; frames.outgoing.length = 0; });
    documents[0].getText("content").insert(0, "!");
    await eventually(() => documents[1].getText("content").toString().startsWith("!"));
    await new Promise(resolve => setTimeout(resolve, 100));
    const updates = (frames: ReturnType<typeof decodeFrame>[]) => frames.filter(frame => frame.type === "sync" && frame.subtype === 2);
    expect(updates(traffic[0].incoming)).toHaveLength(0); // No server reflection to origin.
    expect(updates(traffic[1].outgoing)).toHaveLength(0); // No new local edit from remote apply.
    expect(updates(traffic[1].incoming)).toHaveLength(1);
    const liveBytes = updates(traffic[1].incoming)[0].payload.byteLength + 5;
    const fullBytes = Y.encodeStateAsUpdate(documents[0]).byteLength;
    expect(liveBytes).toBeLessThan(fullBytes / 100);

    // Both peers independently edit while one is disconnected. Its document
    // and binding survive; reconnect negotiates only the missing structs.
    providers[1].disconnect();
    documents[1].getText("content").insert(0, "offline");
    documents[0].transact(() => {
      documents[0].getText("content").delete(10, 20);
      documents[0].getText("content").insert(0, "online");
    });
    traffic.forEach(frames => { frames.incoming.length = 0; frames.outgoing.length = 0; });
    providers[1].connect();
    await eventually(() => providers[1].synced && documents[0].getText("content").toString() === documents[1].getText("content").toString());
    const recovered = documents[0].getText("content").toString();
    expect(recovered.match(/offline/g)).toHaveLength(1);
    expect(recovered.match(/online/g)).toHaveLength(1);
    expect(recovered.length).toBe(baseline.length + "alphabeta!offlineonline".length - 20);
    const steps = [...traffic[1].incoming, ...traffic[1].outgoing].filter(frame => frame.type === "sync" && frame.subtype === 1);
    expect(steps).toHaveLength(2); // Missing server and client updates, one in each direction.
    const recoveryBytes = steps.reduce((sum, frame) => sum + frame.payload.byteLength + 5, 0);
    expect(recoveryBytes).toBeLessThan(fullBytes / 100);
    // A second reconnect replays neither independent edit.
    providers[1].disconnect(); providers[1].connect();
    await eventually(() => providers[1].synced);
    expect(documents[1].getText("content").toString()).toBe(recovered);
    // Complete deletion must remain empty after synchronization/reconnection.
    providers[1].disconnect();
    documents[0].getText("content").delete(0, recovered.length);
    // Deletes do not advance the struct state vector. Step 2 must still carry
    // the delete set when both vectors otherwise match.
    expect(Y.encodeStateVector(documents[0])).toEqual(Y.encodeStateVector(documents[1]));
    providers[1].connect();
    await eventually(() => providers[1].synced && documents[1].getText("content").length === 0);
    expect(documents.every(doc => doc.getText("content").length === 0)).toBe(true);
    console.info(JSON.stringify({ scenario: "day7-differential-sync", baselineBytes: fullBytes, liveFrameBytes: liveBytes, recoveryFrameBytes: recoveryBytes }));
    expect(logs).toContain("collaboration.message.rejected");
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain("Yjs was already imported");
    // Server-origin sync frames use the same validated transport contract.
    const socket = new WebSocket(`${url}/${room}?token=${goodToken}`, WEBSOCKET_PROTOCOL); sockets.push(socket);
    const received = once(socket, "message"); await once(socket, "open");
    expect(decodeFrame((await received)[0]).protocolVersion).toBe(1);
  } finally {
    providers.forEach(provider => provider.destroy()); documents.forEach(doc => doc.destroy()); sockets.forEach(socket => socket.terminate());
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
}, 40_000);

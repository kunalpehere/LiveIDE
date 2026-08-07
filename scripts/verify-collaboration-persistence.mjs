import { spawn } from "node:child_process";
import http from "node:http";
import { SignJWT } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const secret = "stage-11-3-verification-secret";
const room = `persistence-verification-${Date.now()}`;
const collaborationPort = 1236;
const appPort = 3137;
let persistedState = null;

const snapshotServer = http.createServer(async (request, response) => {
  if (request.headers["x-collaboration-secret"] !== secret) {
    response.writeHead(401).end();
    return;
  }
  if (request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    persistedState = JSON.parse(Buffer.concat(chunks).toString()).state;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: persistedState ? { state: persistedState } : { content: "" } }));
});
await new Promise(resolve => snapshotServer.listen(appPort, "127.0.0.1", resolve));

async function accessToken() {
  return new SignJWT({ scope: "collaboration:write", playgroundId: "verification", room, filePath: "src/App.tsx", revision: 1, userId: "user-1" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));
}

async function startCollaborationServer() {
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COLLABORATION_SECRET: secret, COLLABORATION_PORT: String(collaborationPort), COLLABORATION_APP_URL: `http://127.0.0.1:${appPort}` },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${collaborationPort}`)).ok) return child; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Collaboration server did not start");
}

async function stopCollaborationServer(child) {
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}

async function connect() {
  const document = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${collaborationPort}`, room, document, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
    params: { token: await accessToken() },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Sync timed out")), 5000);
    provider.on("sync", synced => { if (synced) { clearTimeout(timeout); resolve(); } });
  });
  return { document, provider };
}

let child;
try {
  child = await startCollaborationServer();
  const first = await connect();
  first.document.getText("content").insert(0, "survives-restart");
  await new Promise(resolve => setTimeout(resolve, 2200));
  first.provider.destroy();
  first.document.destroy();
  await stopCollaborationServer(child);

  child = await startCollaborationServer();
  const second = await connect();
  const restored = second.document.getText("content").toString();
  second.provider.destroy();
  second.document.destroy();
  if (restored !== "survives-restart") throw new Error(`Unexpected restored state: ${restored}`);
  console.log("Collaboration restart recovery verified: survives-restart");
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  await new Promise(resolve => snapshotServer.close(resolve));
}

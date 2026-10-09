import { SignJWT } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { PROTOCOL_VERSION, collaborationRoom } from "../lib/collaboration-protocol.mjs";
import { createProtocolWebSocket } from "../lib/collaboration-websocket.mjs";

const secret = process.env.COLLABORATION_SECRET || "stage-11-2-verification-secret";
const serverUrl = process.env.COLLABORATION_TEST_URL || "ws://127.0.0.1:1235";
const room = collaborationRoom("verification", "verification.txt", 1);
const key = new TextEncoder().encode(secret);

async function token(userId) {
  return new SignJWT({ protocolVersion: PROTOCOL_VERSION, role: "EDITOR", scope: "collaboration:write", playgroundId: "verification", room, filePath: "verification.txt", revision: 1, userId, name: "Verification", color: "#3b82f6" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(key);
}

const docs = [new Y.Doc(), new Y.Doc()];
const providers = await Promise.all(docs.map(async (doc, index) => new WebsocketProvider(serverUrl, room, doc, {
  WebSocketPolyfill: createProtocolWebSocket(WebSocket),
  disableBc: true,
  params: { token: await token(`user-${index + 1}`) },
})));
providers.forEach((provider, index) => {
  provider.on("status", event => console.log(`client-${index + 1}: ${event.status}`));
  provider.on("connection-error", event => console.error(`client-${index + 1} connection error`, event.message || event));
});

await Promise.all(providers.map(provider => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for initial sync")), 5000);
  provider.on("sync", synced => {
    if (synced) {
      clearTimeout(timeout);
      resolve();
    }
  });
})));

docs[0].getText("content").insert(0, "alpha");
docs[1].getText("content").insert(0, "beta");

await new Promise(resolve => setTimeout(resolve, 300));
const values = docs.map(doc => doc.getText("content").toString());
providers.forEach(provider => provider.destroy());
docs.forEach(doc => doc.destroy());

if (values[0] !== values[1] || !values[0].includes("alpha") || !values[0].includes("beta")) {
  throw new Error(`CRDT convergence failed: ${JSON.stringify(values)}`);
}
console.log(`Two-client CRDT convergence verified: ${values[0]}`);

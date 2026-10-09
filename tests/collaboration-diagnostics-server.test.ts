import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";

it("keeps standalone diagnostics unavailable in production even with the service secret", async () => {
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const address = reservation.address(); if (!address || typeof address === "string") throw new Error("No port");
  const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const secret = "f091bc382adc764e532ab48fd0421567e9ac381560dbc73ef429ac085eb7d634";
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true,
    env: { ...process.env, NODE_ENV: "production", ENABLE_MOCK_DB: "false", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port),
      COLLABORATION_SECRET: secret, NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "", COLLABORATION_TEST_MODE: "false", COLLABORATION_APP_URL: "https://127.0.0.1:9" } });
  let logs = ""; child.stdout.on("data", chunk => { logs += chunk.toString(); }); child.stderr.on("data", chunk => { logs += chunk.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Startup deadline")), 20_000);
      child.stdout.on("data", chunk => { if (chunk.toString().includes("collaboration.started")) { clearTimeout(timer); resolve(); } });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Service exited")); });
    });
    for (const headers of [new Headers(), new Headers({ "x-collaboration-secret": secret })]) {
      const response = await fetch(`http://127.0.0.1:${port}/diagnostics`, { headers });
      expect(response.status).toBe(404); expect(await response.json()).toEqual({ code: "NOT_FOUND" });
    }
    expect(logs).not.toContain(secret);
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
}, 30_000);

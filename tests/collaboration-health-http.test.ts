import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";

it("serves separate liveness/readiness and correlates a real dependency failure safely", async () => {
  const temporary = http.createServer();
  temporary.listen(0, "127.0.0.1");
  await once(temporary, "listening");
  const address = temporary.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>(resolve => temporary.close(() => resolve()));
  const child = spawn(process.execPath, ["scripts/collaboration-server.mjs"], { windowsHide: true,
    env: { ...process.env, NODE_ENV: "development", ENABLE_MOCK_DB: "false", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: String(port),
      COLLABORATION_SECRET: "private-health-test-secret", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "", COLLABORATION_TEST_MODE: "false", COLLABORATION_APP_URL: "http://127.0.0.1:9" },
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Collaboration startup deadline")), 20_000);
      const started = (chunk: Buffer) => {
        if (chunk.toString().includes("collaboration.started")) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on("data", started);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Collaboration exited before startup")); });
    });
    const live = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(live.status).toBe(200);
    expect((await live.json()).status).toBe("healthy");
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(ready.status).toBe(503);
    expect((await ready.json()).dependencies.storage.status).toBe("unavailable");
    const requestId = ready.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(output).toContain(requestId!);
    expect(output).not.toContain("private-health-test-secret");
    expect((await fetch(`http://127.0.0.1:${port}/unknown`)).status).toBe(404);
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}, 30_000);

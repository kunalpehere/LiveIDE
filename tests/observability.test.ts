import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRoute } from "@/lib/observe-route";
import { writeLog } from "@/lib/observability.mjs";
import { logger } from "@/lib/logger";
import { probe, summarizeHealth } from "@/lib/health";
import { collaborationReadiness } from "../scripts/collaboration-health.mjs";
import { onRequestError } from "@/instrumentation";
import { POST } from "@/app/api/monitoring/route";

const id = "743adbbf-3aee-453b-8e22-d29558e454f9";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("correlated safe monitoring", () => {
  it("correlates a deliberate failure across logs, response header and body without leaking its cause", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = observeRoute("/api/example", async () => { throw new Error("mongodb://user:private-password@host/db?token=secret"); });
    const response = await handler(new Request("http://localhost/api/example?token=private", { headers: { "x-request-id": id } }));
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(id);
    expect((await response.json()).error.requestId).toBe(id);
    const entries = output.mock.calls.map(([line]) => JSON.parse(line));
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ event: "request.exception", requestId: id }), expect.objectContaining({ event: "request.failed", requestId: id, httpStatus: 500 })]));
    expect(JSON.stringify(entries)).not.toMatch(/password|mongodb|private|token=|host\/db/);
  });

  it("keeps concurrent request contexts separate", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = observeRoute("/api/example", async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      logger.info("inside.handler");
      return Response.json({ ok: true });
    });
    const other = "034caf0e-7dcb-4c49-b764-a942921a8a43";
    await Promise.all([id, other].map(requestId => handler(new Request("http://localhost/api/example", { headers: { "x-request-id": requestId } }))));
    expect(output.mock.calls.map(([line]) => JSON.parse(line)).filter(entry => entry.event === "inside.handler").map(entry => entry.requestId).sort()).toEqual([id, other].sort());
  });

  it("drops arbitrary context, malicious IDs, messages and stacks", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    writeLog("error", "safe.event", { requestId: "secret\nforged", password: "hidden", userId: "private", url: "https://user:pass@host", code: "FAILED" }, new Error("secret code contents"));
    const entry = JSON.parse(output.mock.calls[0][0]);
    expect(entry.code).toBe("FAILED");
    expect(entry.error).toEqual({ name: "Error" });
    expect(entry).not.toHaveProperty("requestId");
    expect(output.mock.calls[0][0]).not.toMatch(/hidden|private|pass@|secret/);
  });

  it("connects framework errors to a safe request ID and digest", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    onRequestError(Object.assign(new Error("private project contents"), { digest: "123456" }),
      { path: "/playground/private?token=secret", method: "GET", headers: { "x-request-id": id, authorization: "Bearer hidden" } },
      { routerKind: "App Router", routePath: "/playground/[id]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ requestId: id, digest: "123456", route: "/playground/[id]" });
    expect(output.mock.calls[0][0]).not.toMatch(/private|secret|hidden/);
  });

  it("ingests browser reports and rejects raw content and cross-origin reports", async () => {
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = (body: unknown, origin = "http://localhost") => POST(new Request("http://localhost/api/monitoring", {
      method: "POST", headers: { origin, "content-type": "application/json", "x-request-id": id }, body: JSON.stringify(body),
    }));
    expect((await send({ eventId: id, source: "runtime.startup", phase: "booting" })).status).toBe(202);
    expect(JSON.parse(errorOutput.mock.calls[0][0])).toMatchObject({ requestId: id, eventId: id, source: "runtime.startup" });
    expect((await send({ eventId: id, source: "browser.error", message: "private code" })).status).toBe(400);
    expect((await send({ eventId: id, source: "browser.error" }, "https://other.example")).status).toBe(403);
    expect((await send({ eventId: id, source: "browser.error", message: "x".repeat(2048) })).status).toBe(413);
    expect(errorOutput).toHaveBeenCalledTimes(1);
  });
});

describe("dependency health", () => {
  it("distinguishes healthy, degraded and unavailable without promoting mocks to production health", () => {
    const healthy = { status: "healthy", code: "READY" } as const;
    const unavailable = { status: "unavailable", code: "PROBE_FAILED" } as const;
    expect(summarizeHealth(healthy, { status: "disabled", code: "NOT_CONFIGURED" }).status).toBe("healthy");
    expect(summarizeHealth(healthy, unavailable)).toMatchObject({ status: "degraded", httpStatus: 200 });
    expect(summarizeHealth({ status: "degraded", code: "DEVELOPMENT_MOCK" }).status).toBe("degraded");
    expect(summarizeHealth(unavailable, healthy)).toMatchObject({ status: "unavailable", httpStatus: 503 });
  });

  it("bounds a hung dependency and converts failures into safe health results", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await probe("database", async () => true)).status).toBe("healthy");
    expect((await probe("database", async () => { throw new Error("private credentials"); })).status).toBe("unavailable");
    vi.useFakeTimers();
    const hanging = probe("database", () => new Promise(() => {}), 50);
    await vi.advanceTimersByTimeAsync(50);
    expect((await hanging).status).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks collaboration's storage and configured Redis rather than just process liveness", async () => {
    const options = { testMode: false, redisConfigured: true, redisReady: () => true, checkStorage: async () => "healthy" };
    expect((await collaborationReadiness(options)).status).toBe("healthy");
    expect((await collaborationReadiness({ ...options, redisReady: () => false })).status).toBe("unavailable");
    expect((await collaborationReadiness({ ...options, checkStorage: async () => { throw new Error("down"); } })).status).toBe("unavailable");
    const storage = vi.fn();
    expect((await collaborationReadiness({ ...options, testMode: true, redisConfigured: false, checkStorage: storage })).status).toBe("degraded");
    expect(storage).not.toHaveBeenCalled();
  });
});

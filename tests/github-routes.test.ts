import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => session);
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { POST } from "@/app/api/github/connect/route";
import { GET as callback } from "@/app/api/github/callback/route";
import { GET, DELETE } from "@/app/api/github/connection/route";

const origin = "http://localhost:3000";
const post = (body: unknown = { access: "public" }, requestOrigin: string | null = origin) => POST(new Request(`${origin}/api/github/connect`, { method: "POST", headers: { "Content-Type": "application/json", ...(requestOrigin ? { Origin: requestOrigin } : {}) }, body: JSON.stringify(body) }));
beforeEach(() => {
  session.auth.mockResolvedValue({ user: { id: crypto.randomUUID() } });
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_ID", "route-repository-app"); vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", "route-secret");
  vi.stubEnv("GITHUB_CONNECTION_ORIGIN", origin); vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "0123456789abcdef".repeat(4));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/user") ? Response.json({ id: 123, login: "octocat" }, { headers: { "x-oauth-scopes": "" } }) : Response.json({ access_token: "gho_route-fixture", token_type: "bearer", scope: "" })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("returns 401 for unauthenticated API requests", async () => {
  session.auth.mockResolvedValue(null);
  expect((await post()).status).toBe(401); expect((await GET()).status).toBe(401);
  expect((await DELETE(new Request(`${origin}/api/github/connection`, { method: "DELETE", headers: { Origin: origin } }))).status).toBe(401);
});
it("blocks missing/foreign origins and unexpected input before authorization", async () => {
  expect((await post({}, null)).status).toBe(403); expect((await post({}, "https://attacker.example")).status).toBe(403);
  expect((await post({ access: "private", userId: "victim" })).status).toBe(400);
  expect((await post({ access: "admin" })).status).toBe(400);
  expect((await DELETE(new Request(`${origin}/api/github/connection`, { method: "DELETE", headers: { Origin: "https://attacker.example" } }))).status).toBe(403);
});
it("sets a short-lived HttpOnly state cookie and returns no secrets", async () => {
  const response = await post(); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/); expect(response.headers.get("set-cookie")).toMatch(/SameSite=lax/);
  expect(response.headers.get("set-cookie")).toMatch(/Max-Age=600/);
  const payload = JSON.stringify(await response.json()); expect(payload).not.toMatch(/route-secret|encryption|code_verifier|access_token/);
});
it("rejects missing browser binding and returns only fixed callback outcomes", async () => {
  const start = await post(); const { url } = await start.json(); const state = new URL(url).searchParams.get("state")!;
  const failed = await callback(new NextRequest(`${origin}/api/github/callback?state=${state}&code=provider-secret&error_description=secret`));
  expect(failed.headers.get("location")).toBe(`${origin}/dashboard/github?github=failed`); expect(fetch).not.toHaveBeenCalled();
  const success = await callback(new NextRequest(`${origin}/api/github/callback?state=${state}&code=provider-secret`, { headers: { Cookie: `liveide-github-state=${state}` } }));
  expect(success.headers.get("location")).toBe(`${origin}/dashboard/github?github=connected`);
  expect(success.headers.get("referrer-policy")).toBe("no-referrer"); expect(success.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  const status = await GET(); expect(JSON.stringify(await status.json())).not.toContain("gho_");
});
it("disables the connection when dedicated configuration is absent", async () => {
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", ""); expect((await post()).status).toBe(503);
  expect((await GET()).status).toBe(200);
});

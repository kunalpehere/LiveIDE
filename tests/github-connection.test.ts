import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { githubConfiguration } from "@/lib/github/config";
import { decrypt, encrypt } from "@/lib/github/crypto";
import { beginConnection, connectionStatus, disconnectConnection, finishConnection } from "@/lib/github/connection";
import { allowedScopes } from "@/lib/github/provider";

const key = "0123456789abcdef".repeat(4);
const token = "gho_private-provider-fixture";
let userId: string;
let scopes: string;
let revoked: boolean;
let unavailable: boolean;
let revokeFails: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  userId = crypto.randomUUID(); scopes = ""; revoked = false; unavailable = false; revokeFails = false;
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_ID", "repository-app");
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", "private-client-secret");
  vi.stubEnv("GITHUB_CONNECTION_ORIGIN", "http://localhost:3000");
  vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", key);
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.cache).toBe("no-store"); expect(init.redirect).toBe("error");
    if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: token, token_type: "bearer", scope: scopes });
    if (url.endsWith("/user")) {
      if (unavailable) return new Response(null, { status: 503 });
      if (revoked) return new Response(null, { status: 401 });
      return Response.json({ id: 42, login: "octocat", access_token: "must-not-escape" }, { headers: { "x-oauth-scopes": scopes } });
    }
    if (url.endsWith("/token")) return new Response(null, { status: revokeFails ? 500 : 204 });
    throw new Error("Unexpected provider endpoint");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function connect(access: "public" | "private" = "public") {
  const attempt = await beginConnection(userId, access);
  await finishConnection(userId, attempt.state, "authorization-code");
  return attempt;
}

describe("GitHub connection security", () => {
  it("uses independent validated configuration and refuses unsafe production origins", () => {
    vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "bad"); expect(githubConfiguration).toThrow();
    vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", key); vi.stubEnv("AUTH_GITHUB_ID", "repository-app"); expect(githubConfiguration).toThrow();
    vi.stubEnv("AUTH_GITHUB_ID", "login-app"); vi.stubEnv("NODE_ENV", "production"); expect(githubConfiguration).toThrow();
    vi.stubEnv("GITHUB_CONNECTION_ORIGIN", "https://liveide.example"); expect(githubConfiguration().callback).toBe("https://liveide.example/api/github/callback");
    for (const origin of ["https://liveide.example/", "https://name:password@liveide.example", "https://liveide.example?x=1"]) {
      vi.stubEnv("GITHUB_CONNECTION_ORIGIN", origin); expect(githubConfiguration).toThrow();
    }
  });
  it("encrypts with unique IVs and rejects tampering, another user, purpose or key", () => {
    const encrypted = encrypt(token, "user:token");
    expect(encrypted).not.toContain(token); expect(encrypt(token, "user:token")).not.toBe(encrypted);
    expect(decrypt(encrypted, "user:token")).toBe(token);
    expect(() => decrypt(encrypted, "other:token")).toThrow();
    expect(() => decrypt(encrypted, "user:pkce")).toThrow();
    const parts = encrypted.split("."); parts[3] = (parts[3][0] === "a" ? "b" : "a") + parts[3].slice(1);
    expect(() => decrypt(parts.join("."), "user:token")).toThrow();
    vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "fedcba9876543210".repeat(4)); expect(() => decrypt(encrypted, "user:token")).toThrow();
  });
  it("requests no scopes by default and keeps PKCE and credentials out of status", async () => {
    const attempt = await connect(); const url = new URL(attempt.url);
    expect(url.searchParams.get("scope")).toBe(""); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const exchange = fetchMock.mock.calls.find(([url]) => url.includes("access_token"))!;
    expect(JSON.parse(exchange[1].body as string).code_verifier).toHaveLength(43);
    const record = await mockDb.gitHubConnection.findUnique({ where: { userId } });
    expect(record?.encryptedToken).not.toContain(token); expect(record?.pendingVerifier).toBeNull();
    const status = await connectionStatus(userId);
    expect(status).toEqual({ configured: true, state: "connected", login: "octocat", access: "public", writeEnabled: false });
    expect(JSON.stringify(status)).not.toMatch(/gho_|access_token|encryptedToken|private-client-secret/);
  });
  it("permits private repositories only after explicit repo authorization", async () => {
    scopes = "repo"; const attempt = await connect("private");
    expect(new URL(attempt.url).searchParams.get("scope")).toBe("repo");
    expect((await connectionStatus(userId)).access).toBe("private");
    expect(allowedScopes("repo, admin:org", "private")).toBe(false);
    expect(allowedScopes("public_repo", "public")).toBe(false);
  });
  it.each(["repo", "user:email", "admin:org", "public_repo"])("rejects unexpected public grants: %s", async grant => {
    scopes = grant; const attempt = await beginConnection(userId, "public");
    await expect(finishConnection(userId, attempt.state, "code")).rejects.toThrow();
    expect((await connectionStatus(userId)).state).toBe("disconnected");
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/token"))).toBe(true);
  });
  it("rejects wrong-user, forged, expired and replayed state before token exchange", async () => {
    const attempt = await beginConnection(userId, "public");
    await expect(finishConnection("other-user", attempt.state, "code")).rejects.toThrow();
    await expect(finishConnection(userId, "forged", "code")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { pendingExpiresAt: new Date(0) } });
    await expect(finishConnection(userId, attempt.state, "code")).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
    const fresh = await connect(); fetchMock.mockClear();
    await expect(finishConnection(userId, fresh.state, "code")).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("only one concurrent callback consumes an attempt", async () => {
    const attempt = await beginConnection(userId, "public");
    const results = await Promise.allSettled([finishConnection(userId, attempt.state, "code"), finishConnection(userId, attempt.state, "code")]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("access_token"))).toHaveLength(1);
  });
  it("denial consumes state and a new attempt supersedes previous tabs", async () => {
    const first = await beginConnection(userId, "public"); const second = await beginConnection(userId, "public");
    await expect(finishConnection(userId, first.state, "code")).rejects.toThrow();
    await expect(finishConnection(userId, second.state, null)).rejects.toThrow();
    await expect(finishConnection(userId, second.state, "code")).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("disconnect clears credentials and pending callbacks even if revocation fails", async () => {
    await connect(); const pending = await beginConnection(userId, "public"); revokeFails = true;
    expect(await disconnectConnection(userId)).toEqual({ revocationPending: true });
    const record = await mockDb.gitHubConnection.findUnique({ where: { userId } });
    expect(record?.encryptedToken).toBeNull(); expect(record?.pendingVerifier).toBeNull();
    await expect(finishConnection(userId, pending.state, "code")).rejects.toThrow();
  });
  it("an in-flight exchange cannot undo disconnect", async () => {
    const attempt = await beginConnection(userId, "public");
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("access_token")) { started(); await gate; }
      return original(url, init);
    });
    const completion = finishConnection(userId, attempt.state, "code");
    const assertion = expect(completion).rejects.toThrow();
    await ready; await disconnectConnection(userId); release(); await assertion;
    expect((await connectionStatus(userId)).state).toBe("revoked");
  });
  it("removes remotely revoked access but retains tokens on temporary outages", async () => {
    await connect(); unavailable = true;
    expect((await connectionStatus(userId)).state).toBe("unavailable");
    expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.encryptedToken).toBeTruthy();
    unavailable = false; revoked = true;
    expect((await connectionStatus(userId)).state).toBe("revoked");
    expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.encryptedToken).toBeNull();
  });
  it("does not revoke a reused token on reconnect or a superseded exchange", async () => {
    await connect(); await connect();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/token"))).toHaveLength(0);
    const attempt = await beginConnection(userId, "public");
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("access_token")) await beginConnection(userId, "public");
      return original(url, init);
    });
    await expect(finishConnection(userId, attempt.state, "code")).rejects.toThrow();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/token"))).toHaveLength(0);
    expect((await connectionStatus(userId)).state).toBe("connected");
  });
  it("revokes a replaced token and reports failed cleanup without leaking either token", async () => {
    await connect(); const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => url.includes("access_token")
      ? Response.json({ access_token: "gho_replacement-token", token_type: "bearer", scope: "" }) : original(url, init));
    revokeFails = true;
    const attempt = await beginConnection(userId, "public");
    expect(await finishConnection(userId, attempt.state, "code")).toEqual({ revocationPending: true });
    const revoke = fetchMock.mock.calls.find(([url]) => url.endsWith("/token"))!;
    expect(JSON.parse(revoke[1].body as string)).toEqual({ access_token: token });
    expect((await connectionStatus(userId)).state).toBe("connected");
  });
  it("requires retry if a token is replaced between disconnect read and removal", async () => {
    await connect(); const original = mockDb.gitHubConnection.updateMany;
    const delegate = vi.spyOn(mockDb.gitHubConnection, "updateMany");
    delegate.mockImplementationOnce(async input => {
      await original({ where: { userId }, data: { encryptedToken: encrypt("new-concurrent-token", `${userId}:token`) } });
      return original(input);
    });
    await expect(disconnectConnection(userId)).rejects.toThrow("retry disconnect");
    expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.encryptedToken).toBeTruthy();
    delegate.mockRestore();
  });
});

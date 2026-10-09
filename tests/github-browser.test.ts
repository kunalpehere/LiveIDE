import { afterEach, beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => session);
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { encrypt } from "@/lib/github/crypto";
import { GET } from "@/app/api/github/browse/route";
import { disconnectConnection } from "@/lib/github/connection";
import { MAX_FILE_BYTES } from "@/lib/github/browse-policy";

const token = "gho_server-only-browser-fixture";
const root = "a".repeat(40), folder = "b".repeat(40), blob = "c".repeat(40);
const repo = { id: 1, owner: { login: "octocat" }, name: "demo", private: false, description: "A project", default_branch: "main", access_token: token, url: "https://evil.example" };
const source = "export const message = '<script>alert(1)</script>';\n";
let userId: string, version: string, scopes: string, privateRepo: boolean;
let entries: unknown[], fileBytes: Buffer;
let fetchMock: ReturnType<typeof vi.fn>;
const response = (value: unknown, headers: Record<string, string> = {}) => Response.json(value, { headers: { "x-oauth-scopes": scopes, ...headers } });
const request = (params: Record<string, string | number | undefined>) => GET(new Request(`http://localhost:3000/api/github/browse?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`));
const list = () => request({ action: "repositories", page: 1 });
const tree = () => request({ action: "tree", owner: "octocat", repo: "demo", branch: "feature/ui" });
async function fileCursor() { const result = await tree(); expect(result.status).toBe(200); return (await result.json()).items.find((item: { name: string }) => item.name === "app.ts").cursor; }

beforeEach(async () => {
  userId = crypto.randomUUID(); version = crypto.randomUUID(); scopes = ""; privateRepo = false; fileBytes = Buffer.from(source);
  entries = [{ path: "src", mode: "040000", type: "tree", sha: folder }, { path: "app.ts", mode: "100644", type: "blob", sha: blob, size: fileBytes.length }];
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_ID", "repository-browser-app"); vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", "server-secret");
  vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "0123456789abcdef".repeat(4)); vi.stubEnv("GITHUB_CONNECTION_ORIGIN", "http://localhost:3000");
  await mockDb.gitHubConnection.upsert({ where: { userId }, create: { userId, version }, update: { version } });
  await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { encryptedToken: encrypt(token, `${userId}:token`), githubUserId: "42", access: "public", scopes: "" } });
  session.auth.mockResolvedValue({ user: { id: userId } });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET"); expect(init.cache).toBe("no-store"); expect(init.redirect).toBe("error");
    expect(new URL(url).origin).toBe("https://api.github.com"); expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
    const path = new URL(url).pathname;
    if (path === "/user") return response({ id: 42 });
    if (path === "/user/repos") return response([{ ...repo, private: privateRepo }], { Link: '<https://evil.example/page=2>; rel="next"' });
    if (path === "/repos/octocat/demo") return response({ ...repo, private: privateRepo });
    if (path === "/repos/octocat/demo/branches") return response([{ name: "main", protected: true }, { name: "feature/ui", protected: false }]);
    if (path === "/repos/octocat/demo/branches/feature%2Fui") return response({ commit: { sha: "d".repeat(40), commit: { tree: { sha: root } } } });
    if (path === `/repos/octocat/demo/git/trees/${root}`) return response({ sha: root, truncated: false, tree: entries });
    if (path === `/repos/octocat/demo/git/trees/${folder}`) return response({ sha: folder, truncated: false, tree: [] });
    if (path === `/repos/octocat/demo/git/blobs/${blob}`) return response({ sha: blob, size: fileBytes.length, encoding: "base64", content: fileBytes.toString("base64") });
    throw new Error("Unexpected provider endpoint");
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("requires authentication, validates strict inputs and rejects arbitrary provider URLs", async () => {
  session.auth.mockResolvedValue(null); expect((await list()).status).toBe(401);
  session.auth.mockResolvedValue({ user: { id: userId } });
  for (const params of [{ action: "repositories", page: "0" }, { action: "repositories", page: "2.5" }, { action: "branches", owner: "../victim", repo: "demo" }, { action: "tree", owner: "octocat", repo: "..", branch: "main" }, { action: "repositories", url: "https://evil.example" }, { action: "file", cursor: "invalid", userId: "victim" }]) expect((await request(params)).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/github/browse?action=repositories&page=1&page=2"))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("paginates and projects repositories without forwarding links or provider credentials", async () => {
  const result = await request({ action: "repositories", page: 2 }); expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  const data = await result.json(); expect(data).toEqual({ items: [{ id: 1, owner: "octocat", name: "demo", private: false, description: "A project", defaultBranch: "main" }], page: 2, hasNext: true });
  expect(JSON.stringify(data)).not.toContain(token); expect(JSON.stringify(data)).not.toContain("evil.example");
  const url = new URL(fetchMock.mock.calls.at(-1)![0]); expect(url.searchParams.get("page")).toBe("2"); expect(url.searchParams.get("visibility")).toBe("public");
});
it("filters private list entries and blocks direct private access under public consent", async () => {
  privateRepo = true; expect((await (await list()).json()).items).toEqual([]);
  expect((await tree()).status).toBe(403);
  expect(fetchMock.mock.calls.some(([url]) => url.includes("/branches/"))).toBe(false);
});
it("allows private repositories only with retained private consent and matching scopes", async () => {
  scopes = "repo"; privateRepo = true;
  await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { access: "private", scopes: "repo" } });
  expect((await (await list()).json()).items[0].private).toBe(true); expect((await tree()).status).toBe(200);
});
it("lists branches and pins directory/file navigation to immutable Git objects", async () => {
  const branches = await request({ action: "branches", owner: "octocat", repo: "demo", page: 2 }); expect(branches.status).toBe(200);
  const result = await tree(); const data = await result.json(); expect(data.items[0].kind).toBe("directory"); expect(data.treeSha).toBe(root);
  const directory = await request({ action: "directory", cursor: data.items[0].cursor, page: 1 }); expect(directory.status).toBe(200); expect((await directory.json()).path).toBe("src");
  const preview = await request({ action: "file", cursor: data.items[1].cursor }); expect(preview.status).toBe(200);
  expect(await preview.json()).toEqual({ content: source, path: "app.ts", branch: "feature/ui", sha: blob, size: fileBytes.length });
  expect(fetchMock.mock.calls.some(([url]) => url.includes("recursive="))).toBe(false);
});
it("paginates large folders locally without recursively fetching the repository", async () => {
  entries = Array.from({ length: 120 }, (_, index) => ({ path: `file-${String(index).padStart(3, "0")}.ts`, type: "blob", mode: "100644", sha: blob, size: fileBytes.length }));
  const first = await (await tree()).json(); expect(first.items).toHaveLength(50); expect(first.hasNext).toBe(true);
  const second = await (await request({ action: "directory", cursor: first.cursor, page: 3 })).json(); expect(second.items).toHaveLength(20); expect(second.hasNext).toBe(false);
});
it("marks oversized, binary-format, symlink and submodule entries as unavailable", async () => {
  entries = [{ path: "big.ts", type: "blob", mode: "100644", sha: blob, size: MAX_FILE_BYTES + 1 }, { path: "logo.png", type: "blob", mode: "100644", sha: blob, size: 5 }, { path: "link.ts", type: "blob", mode: "120000", sha: blob, size: 5 }, { path: "vendor", type: "commit", mode: "160000", sha: blob }];
  const data = await (await tree()).json();
  for (const item of data.items) { expect(item.cursor).toBeNull(); expect(item.restriction).toBeTruthy(); }
  expect(fetchMock.mock.calls.some(([url]) => url.includes("/blobs/"))).toBe(false);
});
it.each([Buffer.from([0xff, 0xfe]), Buffer.from("binary\0data"), Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:abc")])("rejects binary, invalid UTF-8 and Git LFS previews", async bytes => {
  fileBytes = bytes; entries = [{ path: "app.ts", mode: "100644", type: "blob", sha: blob, size: bytes.length }];
  expect((await request({ action: "file", cursor: await fileCursor() })).status).toBe(422);
});
it("rejects forged, wrong-kind, another-user and expired navigation references", async () => {
  const cursor = await fileCursor();
  expect((await request({ action: "directory", cursor })).status).toBe(400);
  expect((await request({ action: "file", cursor: cursor.slice(0, -4) + "AAAA" })).status).toBe(400);
  const other = crypto.randomUUID(); await mockDb.gitHubConnection.upsert({ where: { userId: other }, create: { userId: other, version, githubUserId: "42", access: "public", encryptedToken: encrypt(token, `${other}:token`) }, update: {} });
  session.auth.mockResolvedValue({ user: { id: other } }); expect((await request({ action: "file", cursor })).status).toBe(400);
  session.auth.mockResolvedValue({ user: { id: userId } }); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31 * 60_000);
  expect((await request({ action: "file", cursor })).status).toBe(400);
});
it("does not return in-flight data after disconnect", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const result = await original(url, init);
    if (url.includes("/user/repos")) await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { encryptedToken: null } });
    return result;
  });
  const result = await list(); expect(result.status).toBe(409); expect((await result.json()).code).toBe("CONNECTION_CHANGED");
});
it("clears remotely revoked tokens and refuses missing or superseded connections", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 401 })); expect((await list()).status).toBe(409);
  expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.encryptedToken).toBeNull();
  fetchMock.mockClear(); expect((await list()).status).toBe(409); expect(fetchMock).not.toHaveBeenCalled();
});
it.each([{ status: 429, headers: { "retry-after": "120" }, body: {} }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 300) }, body: {} }, { status: 403, headers: {}, body: { message: `Secondary rate limit exceeded ${token}` } }])("honors provider cooldowns and returns safe rate-limit errors", async fixture => {
  fetchMock.mockResolvedValue(Response.json(fixture.body, { status: fixture.status, headers: Object.fromEntries(Object.entries(fixture.headers).filter(([, value]) => value !== undefined)) }));
  const first = await list(); expect(first.status).toBe(429); expect(Number(first.headers.get("retry-after"))).toBeGreaterThanOrEqual(60);
  const payload = await first.json(); expect(payload.code).toBe("RATE_LIMITED"); expect(JSON.stringify(payload)).not.toContain(token);
  fetchMock.mockClear(); expect((await list()).status).toBe(429); expect(fetchMock).not.toHaveBeenCalled();
});
it.each([403, 404, 409, 500])("reports permission, missing, empty and unavailable provider failures: %s", async status => {
  fetchMock.mockResolvedValue(Response.json({ message: token }, { status }));
  const result = await list(); expect([403, 404, 409, 503]).toContain(result.status); expect(await result.text()).not.toContain(token);
});
it("rejects truncated or unsafe tree responses and bounded oversized payloads", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => url.includes(`/trees/${root}`) ? response({ sha: root, truncated: true, tree: [] }) : original(url, init));
  expect((await tree()).status).toBe(422);
  entries = [{ path: "../escape.ts", mode: "100644", type: "blob", sha: blob, size: 1 }]; fetchMock.mockImplementation(original);
  expect((await tree()).status).toBe(502);
  fetchMock.mockResolvedValue(new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } })); expect((await list()).status).toBe(422);
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } })));
  expect((await list()).status).toBe(422);
});
it("invalidates changed provider scopes instead of using silently broadened authorization", async () => {
  scopes = "repo"; expect((await list()).status).toBe(409);
  expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.encryptedToken).toBeNull();
});

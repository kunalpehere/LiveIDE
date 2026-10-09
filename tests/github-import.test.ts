import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => session);
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { encrypt } from "@/lib/github/crypto";
import { signCursor } from "@/lib/github/browse-cursor";
import { createBrowseClient } from "@/lib/github/browse-client";
import { POST } from "@/app/api/github/import/route";

const root = "a".repeat(40), folder = "b".repeat(40), commit = "d".repeat(40);
const repo = { id: 42, name: "demo", owner: { login: "octocat" }, private: false, description: null, default_branch: "main" };
type Entry = { path: string; sha: string; mode: string; type: string; size?: number };
let entries: Entry[], blobs: Map<string, Buffer>, userId: string, version: string, fetchMock: ReturnType<typeof vi.fn>, cursor: string;
function file(path: string, content: string | Buffer, mode = "100644") {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  blobs.set(sha, bytes); return { path, sha, mode, type: "blob", size: bytes.length };
}
const request = (data: unknown, headers: Record<string, string> = {}) => POST(new Request("http://localhost:3000/api/github/import", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(data) }));
const review = () => request({ action: "review", cursor, title: "Imported demo" });
async function plan() { const result = await review(); expect(result.status).toBe(200); return (await result.json()).plan as string; }
const create = (plan: string, acceptOmissions = false) => request({ action: "create", plan, acceptOmissions });
const projects = () => mockDb.playground.findMany({ where: { userId } });
async function storedProject(id: string) {
  const project = await mockDb.playground.findUnique({ where: { id } });
  if (!project || !("githubSource" in project)) throw new Error("Expected stored project metadata");
  return project;
}
beforeEach(async () => {
  userId = crypto.randomUUID(); version = crypto.randomUUID(); blobs = new Map();
  entries = [file("package.json", '{"dependencies":{"next":"16"}}'), { path: "src", sha: folder, mode: "040000", type: "tree" }, file("src/app.ts", "export const value = 1;\n"), file(".gitignore", "node_modules\n"), file("package-lock.json", "{}")];
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_ID", "import-app"); vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", "secret");
  vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "0123456789abcdef".repeat(4)); vi.stubEnv("GITHUB_CONNECTION_ORIGIN", "http://localhost:3000");
  await mockDb.gitHubConnection.upsert({ where: { userId }, create: { userId, version, encryptedToken: encrypt("gho_import_fixture", `${userId}:token`), githubUserId: "42", access: "public", scopes: "" }, update: {} });
  session.auth.mockResolvedValue({ user: { id: userId } });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET"); expect(new URL(url).origin).toBe("https://api.github.com");
    const path = new URL(url).pathname;
    if (path === "/user") return Response.json({ id: 42 });
    if (path === "/repos/octocat/demo") return Response.json(repo);
    if (path.includes("/git/trees/")) return Response.json({ sha: path.split("/").at(-1), truncated: false, tree: entries });
    if (path.includes("/git/blobs/")) { const sha = path.split("/").at(-1)!, bytes = blobs.get(sha)!; return Response.json({ sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") }); }
    throw new Error("Unexpected provider call");
  }); vi.stubGlobal("fetch", fetchMock);
  const client = await createBrowseClient(userId);
  cursor = await signCursor(client, { owner: "octocat", repo: "demo", branch: "feature/ui", path: "", sha: root, rootTreeSha: root, commitSha: commit, kind: "directory", size: null });
  fetchMock.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("reviews without writing, creates complete source files and retains the baseline independently of saves", async () => {
  const result = await review(), data = await result.json();
  expect(data).toMatchObject({ fileCount: 4, template: "NEXTJS", title: "Imported demo", commitSha: commit, omitted: [] });
  expect(await projects()).toHaveLength(0); expect(JSON.stringify(data)).not.toContain("gho_import_fixture");
  const imported = await (await create(data.plan)).json();
  const project = await storedProject(imported.projectId);
  expect(project).toMatchObject({ userId, template: "NEXTJS", githubSource: { repositoryId: 42, branch: "feature/ui", commitSha: commit, rootTreeSha: root, treeSha: root, folder: "" } });
  const stored = await mockDb.templateFile.findUnique({ where: { playgroundId: imported.projectId } });
  expect(typeof stored!.content).toBe("string");
  expect(JSON.parse(stored!.content as string).items).toEqual(expect.arrayContaining([expect.objectContaining({ filename: ".gitignore", fileExtension: "", content: "node_modules\n" }), expect.objectContaining({ folderName: "src" })]));
  const baseline = structuredClone(project.githubSource);
  await mockDb.templateFile.update({ where: { playgroundId: imported.projectId }, data: { content: "changed locally" } });
  expect((await storedProject(imported.projectId)).githubSource).toEqual(baseline);
  expect(fetchMock.mock.calls.every(([url]) => !url.includes("/branches/"))).toBe(true);
});
it("imports a folder relative to the project root while retaining original repository paths", async () => {
  entries = [file("index.ts", "export default 1;")];
  cursor = await signCursor(await createBrowseClient(userId), { owner: "octocat", repo: "demo", branch: "main", path: "packages/app", sha: folder, rootTreeSha: root, commitSha: commit, kind: "directory", size: null });
  const imported = await (await create(await plan())).json();
  expect((await storedProject(imported.projectId)).githubSource).toMatchObject({ folder: "packages/app", treeSha: folder, files: [expect.objectContaining({ path: "index.ts", originalPath: "packages/app/index.ts" })] });
});
it("requires explicit agreement for binaries, symlinks, submodules and LFS omissions", async () => {
  entries.push(file("logo.png", "image"), file("binary.ts", Buffer.from([0xff])), file("link.ts", "src/app.ts", "120000"), file("asset.txt", "version https://git-lfs.github.com/spec/v1\n"), { path: "vendor", type: "commit", mode: "160000", sha: root });
  const data = await (await review()).json(); expect(data.omitted).toHaveLength(5);
  expect((await create(data.plan)).status).toBe(400); expect(await projects()).toHaveLength(0);
  expect((await create(data.plan, true)).status).toBe(200);
});
it("rejects source changes between review and creation without persisting a partial project", async () => {
  const token = await plan(); entries.push(file("added.ts", "new source"));
  expect((await create(token)).status).toBe(409); expect(await projects()).toHaveLength(0);
});
it("preserves BOM text, empty files and executable identities", async () => {
  entries = [file("app.ts", "\ufeffexport default 1;", "100755"), file("empty.txt", "")];
  const imported = await (await create(await plan())).json();
  const project = await storedProject(imported.projectId);
  expect(project.githubSource).toMatchObject({ files: expect.arrayContaining([expect.objectContaining({ path: "app.ts", mode: "100755" })]) });
  const stored = await mockDb.templateFile.findUnique({ where: { playgroundId: imported.projectId } });
  expect(JSON.parse(stored!.content as string).items).toEqual(expect.arrayContaining([expect.objectContaining({ filename: "app", content: "\ufeffexport default 1;" }), expect.objectContaining({ filename: "empty", content: "" })]));
});
it("retries and concurrent creation produce one new project without overwriting an existing project", async () => {
  const original = await mockDb.playground.create({ data: { title: "Existing", userId, template: "REACT" } });
  const token = await plan(); const results = await Promise.all([create(token), create(token)]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const ids = await Promise.all(results.map(async result => (await result.json()).projectId)); expect(ids[0]).toBe(ids[1]);
  expect((await (await create(token)).json()).projectId).toBe(ids[0]);
  expect(await projects()).toHaveLength(2); expect((await storedProject(original.id)).title).toBe("Existing");
});
it.each(["../escape.ts", "src/../../escape.ts", "C:/file.ts", "a\\b.ts", ".git/config", ".liveide/config.ts", "CON.ts", "name .ts/child.ts", "a/".repeat(22) + "file.ts"])("rejects unsafe paths: %s", async path => {
  entries = [file(path, "text")]; expect([422, 502]).toContain((await review()).status); expect(await projects()).toHaveLength(0);
});
it.each(["duplicate", "case", "parent"])("rejects ambiguous paths: %s", async kind => {
  entries = kind === "parent" ? [file("src", "text"), file("src/a.ts", "text")] : [file("app.ts", "text"), file(kind === "case" ? "APP.ts" : "app.ts", "other")];
  expect((await review()).status).toBe(422); expect(await projects()).toHaveLength(0);
});
it.each(["file", "count", "total", "serialized"])("rejects exceeded %s limits before persistence", async kind => {
  if (kind === "file") entries = [file("big.ts", "x".repeat(256 * 1024 + 1))];
  if (kind === "count") entries = Array.from({ length: 251 }, (_, i) => file(`${i}.ts`, "x"));
  if (kind === "total") entries = Array.from({ length: 9 }, (_, i) => file(`${i}.ts`, "x".repeat(256 * 1024)));
  if (kind === "serialized") entries = Array.from({ length: 8 }, (_, i) => file(`${i}.ts`, "\"".repeat(200 * 1024)));
  expect((await review()).status).toBe(422); expect(await projects()).toHaveLength(0);
});
it("fails safely for truncated trees, corrupt objects, empty source and provider failure", async () => {
  const implementation = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => url.includes("/trees/") ? Response.json({ sha: root, truncated: true, tree: [] }) : implementation(url, init));
  expect((await review()).status).toBe(422);
  fetchMock.mockImplementation(implementation); entries = [file("only.png", "image")]; expect((await review()).status).toBe(422);
  entries = [file("app.ts", "original")]; blobs.set(entries[0].sha, Buffer.from("corrupt!")); expect((await review()).status).toBe(422);
  fetchMock.mockResolvedValue(new Response(null, { status: 500 })); expect((await review()).status).toBe(503);
  expect(await projects()).toHaveLength(0);
});
it("rejects forged, expired and another-user plans", async () => {
  const token = await plan(); expect((await create(token.slice(0, -5) + "AAAAA")).status).toBe(400);
  const other = crypto.randomUUID(); await mockDb.gitHubConnection.upsert({ where: { userId: other }, create: { userId: other, version, encryptedToken: encrypt("gho_import_fixture", `${other}:token`), githubUserId: "42", access: "public", scopes: "" }, update: {} });
  session.auth.mockResolvedValue({ user: { id: other } }); expect((await create(token)).status).toBe(400);
  session.auth.mockResolvedValue({ user: { id: userId } }); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000); expect((await create(token)).status).toBe(400);
  expect(await projects()).toHaveLength(0);
});
it("does not persist after authorization changes in flight or after failed database creation", async () => {
  const token = await plan(), implementation = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => { const response = await implementation(url, init); if (url.includes("/blobs/")) await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { version: "changed" } }); return response; });
  expect((await create(token)).status).toBe(409); expect(await projects()).toHaveLength(0);
  fetchMock.mockImplementation(implementation); await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { version } });
  const original = mockDb.playground.create;
  vi.spyOn(mockDb.playground, "create").mockImplementation(async input => { await original(input); throw new Error("fixture persistence failure"); });
  expect((await create(token)).status).toBe(503); expect(await projects()).toHaveLength(0);
});
it("enforces authentication, same-origin requests and bounded strict JSON bodies", async () => {
  session.auth.mockResolvedValue(null); expect((await review()).status).toBe(401);
  session.auth.mockResolvedValue({ user: { id: userId } });
  expect((await request({ action: "review", cursor, title: "a" }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await request({ action: "review", cursor, title: "a", projectId: "victim" })).status).toBe(400);
  expect((await request({ action: "review", cursor, title: "a".repeat(21000) })).status).toBe(413);
  expect((await request({}, { "content-type": "text/plain" })).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
});

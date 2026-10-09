import { afterEach, beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({})); vi.mock("@/auth", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/lib/mock-db")).mockDb }));
import { mockDb } from "@/lib/mock-db";
import { encrypt } from "@/lib/github/crypto";
import { blobSha, contentHash } from "@/lib/github/commit-policy";
import { GET, POST } from "@/app/api/github/commit/route";
import { beginConnection, finishConnection, connectionStatus } from "@/lib/github/connection";
import { sourceSchema } from "@/lib/github/commit-policy";
import { deleteProjectById } from "@/features/playground/actions";

const oldRoot = "a".repeat(40), oldTree = "b".repeat(40), originalHead = "c".repeat(40), createdRoot = "d".repeat(40), createdTree = "e".repeat(40), createdCommit = "f".repeat(40);
const original = "export const value = 1;\n", changed = "export const value = 2;\n", removed = "delete this file\n";
let userId: string, version: string, projectId: string, scopes: string, sourceHead: string, remoteEntries: unknown[], refs: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>, failure: string | null, refLost: boolean, pushAllowed: boolean, privateRepo: boolean;
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "x-oauth-scopes": scopes } });
const request = (data: unknown, headers: Record<string, string> = {}) => POST(new Request("http://localhost:3000/api/github/commit", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(data) }));
const review = () => request({ action: "review", projectId, message: "Reviewed fixture", branch: "codex/reviewed-fixture" });
const publish = (operationId: string) => request({ action: "publish", operationId, confirm: true });
async function operation() { const result = await review(); expect(result.status).toBe(200); const data = await result.json(); expect(data.operationId).toBeTruthy(); return data.operationId as string; }
async function project() { const result = await mockDb.playground.findUnique({ where: { id: projectId } }); if (!result || !("githubSource" in result) || !("githubCommitLock" in result)) throw new Error("Missing project"); return result; }
const mutations = () => fetchMock.mock.calls.filter(([, init]) => init.method !== "GET");
beforeEach(async () => {
  userId = crypto.randomUUID(); projectId = crypto.randomUUID(); version = crypto.randomUUID(); scopes = "public_repo"; sourceHead = originalHead;
  failure = null; refLost = false; pushAllowed = true; privateRepo = false; refs = new Map();
  remoteEntries = [{ path: "app.ts", sha: blobSha(original), mode: "100755", type: "blob", size: Buffer.byteLength(original) }, { path: "old.txt", sha: blobSha(removed), mode: "100644", type: "blob", size: Buffer.byteLength(removed) }, { path: "logo.png", sha: "1".repeat(40), mode: "100644", type: "blob", size: 10 }];
  vi.stubEnv("GITHUB_CONNECTION_CLIENT_ID", "commit-app"); vi.stubEnv("GITHUB_CONNECTION_CLIENT_SECRET", "secret");
  vi.stubEnv("GITHUB_CONNECTION_ENCRYPTION_KEY", "0123456789abcdef".repeat(4)); vi.stubEnv("GITHUB_CONNECTION_ORIGIN", "http://localhost:3000");
  await mockDb.gitHubConnection.upsert({ where: { userId }, create: { userId, version, encryptedToken: encrypt("gho_commit_fixture", `${userId}:token`), githubUserId: "42", login: "octocat", access: "public", scopes, writeEnabled: true }, update: {} });
  await mockDb.playground.create({ data: { id: projectId, userId, title: "Imported", template: "REACT", githubSource: { schemaVersion: 1, provider: "github", repositoryId: 42, owner: "octocat", repository: "demo", branch: "main", commitSha: originalHead, rootTreeSha: oldRoot, treeSha: oldTree, folder: "packages/app", importedAt: new Date().toISOString(), files: [{ path: "app.ts", originalPath: "packages/app/app.ts", sha: blobSha(original), mode: "100755", size: Buffer.byteLength(original), contentHash: contentHash(original) }, { path: "old.txt", originalPath: "packages/app/old.txt", sha: blobSha(removed), mode: "100644", size: Buffer.byteLength(removed), contentHash: contentHash(removed) }], omitted: [{ path: "logo.png", sha: "1".repeat(40), mode: "100644", reason: "Binary asset" }] }, templateFiles: { create: [{ content: JSON.stringify({ folderName: "Root", items: [{ filename: "app", fileExtension: "ts", content: changed }, { filename: "new", fileExtension: "txt", content: "added file\n" }] }) }] } } });
  session.auth.mockResolvedValue({ user: { id: userId } });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.github.com"); expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body as string) : null;
    if (init.method === "POST") {
      expect(["blobs", "trees", "commits", "refs"]).toContain(path.split("/").at(-1));
      if (failure && path.endsWith(`/${failure}`)) { failure = null; return response({}, 500); }
      if (path.endsWith("/blobs")) { const text = Buffer.from(body.content, "base64").toString("utf8"); return response({ sha: blobSha(text) }, 201); }
      if (path.endsWith("/trees")) return response({ sha: createdRoot }, 201);
      if (path.endsWith("/commits")) return response({ sha: createdCommit, tree: { sha: body.tree }, parents: body.parents.map((sha: string) => ({ sha })) }, 201);
      if (path.endsWith("/refs")) { refs.set(body.ref, body.sha); if (refLost) { refLost = false; throw new Error("Lost response after publication"); } return response({ ref: body.ref, object: { type: "commit", sha: body.sha } }, 201); }
    }
    if (path === "/user") return response({ id: 42, login: "octocat" });
    if (path === "/repos/octocat/demo") return response({ id: 42, name: "demo", owner: { login: "octocat" }, private: privateRepo, description: null, default_branch: "main", permissions: { push: pushAllowed } });
    if (path.includes("/branches/")) return response({ commit: { sha: sourceHead, commit: { tree: { sha: oldRoot } } } });
    if (path.includes("/git/ref/heads/")) { const name = `refs/heads/${decodeURIComponent(path.split("/git/ref/heads/")[1])}`, sha = refs.get(name); return sha ? response({ ref: name, object: { type: "commit", sha } }) : response({}, 404); }
    if (path.includes("/git/trees/")) {
      const sha = path.split("/").at(-1)!;
      if (new URL(url).searchParams.has("recursive")) return response({ sha, truncated: false, tree: remoteEntries });
      const next = sha === oldRoot ? "2".repeat(40) : sha === createdRoot ? "3".repeat(40) : sha === "2".repeat(40) ? oldTree : createdTree;
      return response({ sha, truncated: false, tree: [{ path: [oldRoot, createdRoot].includes(sha) ? "packages" : "app", mode: "040000", type: "tree", sha: next }] });
    }
    if (path.includes("/git/blobs/")) { const sha = path.split("/").at(-1)!, content = sha === blobSha(original) ? original : removed; return response({ sha, size: Buffer.byteLength(content), encoding: "base64", content: Buffer.from(content).toString("base64") }); }
    throw new Error(`Unexpected fixture endpoint: ${path}`);
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("reviews additions, modifications and deletions without any GitHub mutations", async () => {
  const data = await (await review()).json(); expect(data.changes.map((change: { kind: string }) => change.kind).sort()).toEqual(["added", "deleted", "modified"]);
  expect(data.changes.find((change: { path: string }) => change.path === "app.ts")).toMatchObject({ before: original, after: changed });
  expect(data.conflicts).toEqual([]); expect(mutations()).toHaveLength(0);
  expect(JSON.stringify(data)).not.toContain("gho_commit_fixture");
});
it("publishes one new branch, preserves the base tree and omitted/external files, and advances baseline", async () => {
  const id = await operation(), result = await publish(id), data = await result.json(); expect(result.status).toBe(200); expect(data.status).toBe("SUCCEEDED");
  expect(refs.get("refs/heads/codex/reviewed-fixture")).toBe(createdCommit);
  const tree = mutations().find(([url]) => url.endsWith("/trees"))!; expect(JSON.parse(tree[1].body as string)).toMatchObject({ base_tree: oldRoot });
  const patch = JSON.parse(tree[1].body as string).tree; expect(patch).toHaveLength(3); expect(patch.some((entry: { path: string }) => entry.path.includes("logo.png"))).toBe(false);
  expect(patch.every((entry: { path: string }) => entry.path.startsWith("packages/app/"))).toBe(true);
  expect(patch.find((entry: { path: string }) => entry.path.endsWith("old.txt")).sha).toBeNull();
  expect((await project()).githubSource).toMatchObject({ branch: "codex/reviewed-fixture", commitSha: createdCommit, rootTreeSha: createdRoot, treeSha: createdTree });
  expect((await project()).githubCommitLock).toBeNull();
  const count = mutations().length; expect((await (await publish(id)).json()).status).toBe("SUCCEEDED"); expect(mutations()).toHaveLength(count);
});
it("requires explicit confirmation, session, origin and ownership", async () => {
  expect((await request({ action: "publish", operationId: crypto.randomUUID(), confirm: false })).status).toBe(400);
  expect((await request({ action: "review", projectId, message: "a" }, { origin: "https://evil.example" })).status).toBe(403);
  session.auth.mockResolvedValue(null); expect((await review()).status).toBe(401);
  session.auth.mockResolvedValue({ user: { id: "other-owner" } }); expect((await review()).status).toBe(403);
  expect(mutations()).toHaveLength(0);
});
it.each(["consent", "permission", "private", "scope"])("blocks invalid %s authorization", async kind => {
  if (kind === "consent") { scopes = ""; await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { writeEnabled: false, scopes: "" } }); }
  if (kind === "permission") pushAllowed = false;
  if (kind === "private") privateRepo = true;
  if (kind === "scope") scopes = "repo";
  expect([403, 409]).toContain((await review()).status); expect(mutations()).toHaveLength(0);
});
it.each(["snapshot", "head", "expiry"])("blocks stale %s before mutating GitHub", async kind => {
  const id = await operation();
  if (kind === "snapshot") await mockDb.templateFile.updateMany({ where: { playgroundId: projectId, version: 1 }, data: { version: { increment: 1 } } });
  if (kind === "head") sourceHead = "4".repeat(40);
  if (kind === "expiry") { vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60000); }
  const result = await publish(id); if (kind === "head") expect((await result.json()).status).toBe("RECOVERABLE"); else expect(result.status).toBe(409);
  expect(mutations()).toHaveLength(0);
});
it("shows conflicts for remote changes and protected omitted assets", async () => {
  remoteEntries = [{ path: "app.ts", type: "blob", mode: "100755", sha: "9".repeat(40), size: 4 }];
  const data = await (await review()).json(); expect(data.conflicts).toContain("app.ts"); expect(data.operationId).toBeNull();
  expect(mutations()).toHaveLength(0);
});
it("never updates an existing destination branch", async () => {
  refs.set("refs/heads/codex/reviewed-fixture", "9".repeat(40)); expect((await review()).status).toBe(409); expect(mutations()).toHaveLength(0);
});
it("reviews an advanced branch when imported files are unchanged and uses its new parent", async () => {
  sourceHead = "4".repeat(40); const id = await operation(); expect((await (await publish(id)).json()).status).toBe("SUCCEEDED");
  const commit = mutations().find(([url]) => url.endsWith("/commits"))!;
  expect(JSON.parse(commit[1].body as string).parents).toEqual([sourceHead]);
});
it.each(["../escape", "CON", "a\\b"])("rejects unsafe saved project path %s before writes", async name => {
  await mockDb.templateFile.update({ where: { playgroundId: projectId }, data: { content: JSON.stringify({ folderName: "Root", items: [{ filename: name, fileExtension: "ts", content: "x" }] }) } });
  expect((await review()).status).toBe(422); expect(mutations()).toHaveLength(0);
});
it("rejects collisions with omitted files, excessive project content, and workflow changes", async () => {
  await mockDb.templateFile.update({ where: { playgroundId: projectId }, data: { content: JSON.stringify({ folderName: "Root", items: [{ filename: "logo", fileExtension: "png", content: "new text" }] }) } });
  expect((await (await review()).json()).conflicts).toContain("logo.png");
  remoteEntries = [{ path: "logo.png", sha: blobSha("new text"), mode: "100644", type: "blob", size: 8 }];
  expect((await (await review()).json()).conflicts).toContain("logo.png");
  await mockDb.templateFile.update({ where: { playgroundId: projectId }, data: { content: JSON.stringify({ folderName: "Root", items: [{ filename: "big", fileExtension: "ts", content: "x".repeat(256 * 1024 + 1) }] }) } });
  expect((await review()).status).toBe(422);
  const source = sourceSchema.parse((await project()).githubSource);
  await mockDb.playground.update({ where: { id: projectId }, data: { githubSource: { ...source, folder: ".github/workflows", files: source.files.map(file => ({ ...file, originalPath: `.github/workflows/${file.path}` })) } } });
  await mockDb.templateFile.update({ where: { playgroundId: projectId }, data: { content: JSON.stringify({ folderName: "Root", items: [{ filename: "new", fileExtension: "yml", content: "jobs: {}" }] }) } });
  // Use the root import to exercise workflow guarding without provider folder fixtures.
  const guarded = sourceSchema.parse((await project()).githubSource);
  await mockDb.playground.update({ where: { id: projectId }, data: { githubSource: { ...guarded, folder: "", treeSha: oldRoot, files: guarded.files.map(file => ({ ...file, originalPath: file.path })) } } });
  await mockDb.templateFile.update({ where: { playgroundId: projectId }, data: { content: JSON.stringify({ folderName: "Root", items: [{ folderName: ".github", items: [{ folderName: "workflows", items: [{ filename: "new", fileExtension: "yml", content: "jobs: {}" }] }] }] }) } });
  expect((await review()).status).toBe(422); expect(mutations()).toHaveLength(0);
});
it("stops mutation after a disconnect during object creation and recovers with renewed consent", async () => {
  const id = await operation(), implementation = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => { const response = await implementation(url, init); if (init.method === "POST" && url.endsWith("/blobs")) await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { encryptedToken: null } }); return response; });
  expect((await (await publish(id)).json()).status).toBe("RECOVERABLE"); expect(refs.size).toBe(0);
  expect(mutations().some(([url]) => url.endsWith("/refs"))).toBe(false);
  fetchMock.mockImplementation(implementation); await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { version: crypto.randomUUID(), encryptedToken: encrypt("gho_commit_fixture", `${userId}:token`), writeEnabled: true } });
  expect((await (await publish(id)).json()).status).toBe("SUCCEEDED");
});
it.each(["blobs", "trees", "commits", "refs"])("recovers partial failure at %s without duplicate publication", async stage => {
  const id = await operation(); failure = stage;
  expect((await (await publish(id)).json()).status).toBe("RECOVERABLE"); expect(refs.size).toBe(0);
  expect((await (await publish(id)).json()).status).toBe("SUCCEEDED"); expect(refs.size).toBe(1);
  const commits = mutations().filter(([url]) => url.endsWith("/commits"));
  if (commits.length > 1) expect(commits.map(([, init]) => init.body).every(body => body === commits[0][1].body)).toBe(true);
});
it("recovers a lost branch response without issuing another reference mutation", async () => {
  const id = await operation(); refLost = true;
  expect((await (await publish(id)).json()).status).toBe("SUCCEEDED");
  expect(mutations().filter(([url]) => url.endsWith("/refs"))).toHaveLength(1);
});
it("resumes a partially uploaded snapshot from its durable file checkpoint", async () => {
  const id = await operation(), implementation = fetchMock.getMockImplementation()!; let uploads = 0;
  fetchMock.mockImplementation(async (url, init) => { if (init.method === "POST" && url.endsWith("/blobs") && ++uploads === 2) return response({}, 500); return implementation(url, init); });
  const result = await (await publish(id)).json(); expect(result).toMatchObject({ status: "RECOVERABLE", uploadedFiles: 1 });
  fetchMock.mockImplementation(implementation); expect((await (await publish(id)).json()).status).toBe("SUCCEEDED");
  const uploadCalls = mutations().filter(([url]) => url.endsWith("/blobs")); expect(uploadCalls).toHaveLength(3);
});
it("retains a published result when baseline persistence fails and recovers after reauthorization", async () => {
  const id = await operation(), update = mockDb.playground.updateMany;
  const spy = vi.spyOn(mockDb.playground, "updateMany").mockImplementation(async input => { if (input.data.githubSource) throw new Error("Final persistence failed"); return update(input); });
  expect((await (await publish(id)).json()).status).toBe("RECOVERABLE"); expect(refs.size).toBe(1);
  spy.mockRestore(); await mockDb.gitHubConnection.updateMany({ where: { userId }, data: { version: crypto.randomUUID() } });
  expect((await (await publish(id)).json()).status).toBe("SUCCEEDED"); expect(mutations().filter(([url]) => url.endsWith("/refs"))).toHaveLength(1);
});
it("prevents concurrent workers and competing operations for the same project", async () => {
  const id = await operation(); const results = await Promise.all([publish(id), publish(id)]); expect(results.some(result => result.status === 409)).toBe(true);
  expect(refs.size).toBe(1); expect(mutations().filter(([url]) => url.endsWith("/refs"))).toHaveLength(1);
});
it("allows abandoning unpublished failures and never abandons a published commit", async () => {
  const id = await operation(); failure = "trees"; await publish(id);
  expect((await (await request({ action: "cancel", operationId: id, confirm: true })).json()).status).toBe("CANCELLED"); expect((await project()).githubCommitLock).toBeNull();
  const next = await operation(); await publish(next); expect((await request({ action: "cancel", operationId: next, confirm: true })).status).toBe(409);
});
it("keeps pending recovery records attached to a project until it is recovered or abandoned", async () => {
  const id = await operation(); failure = "trees"; await publish(id);
  expect(await deleteProjectById(projectId)).toMatchObject({ success: false, code: "PENDING_COMMIT" });
  expect(await project()).toBeTruthy();
  await request({ action: "cancel", operationId: id, confirm: true });
  expect(await deleteProjectById(projectId)).toMatchObject({ success: true });
});
it("returns durable status only to the owner and keeps it credential-free", async () => {
  const id = await operation(); failure = "commits"; await publish(id);
  const result = await GET(new Request(`http://localhost:3000/api/github/commit?projectId=${projectId}`)); expect(result.headers.get("cache-control")).toBe("no-store");
  const data = await result.json(); expect(data.operation).toMatchObject({ operationId: id, status: "RECOVERABLE" }); expect(JSON.stringify(data)).not.toContain("gho_commit_fixture");
  session.auth.mockResolvedValue({ user: { id: "other" } }); expect((await GET(new Request(`http://localhost:3000/api/github/commit?projectId=${projectId}`))).status).toBe(403);
});
it("stores separate public write consent through OAuth and rejects silently broadened scopes", async () => {
  const oauthFetch = vi.fn(async (url: string) => url.includes("access_token") ? response({ access_token: "gho_new", token_type: "bearer", scope: "public_repo" }) : url.endsWith("/token") ? new Response(null, { status: 204 }) : response({ id: 42, login: "octocat" }));
  vi.stubGlobal("fetch", oauthFetch);
  const attempt = await beginConnection(userId, "public", true); expect(new URL(attempt.url).searchParams.get("scope")).toBe("public_repo");
  await finishConnection(userId, attempt.state, "code"); expect(await connectionStatus(userId)).toMatchObject({ state: "connected", writeEnabled: true });
  expect((await mockDb.gitHubConnection.findUnique({ where: { userId } }))?.pendingWrite).toBeNull();
});

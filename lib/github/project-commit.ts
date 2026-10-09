import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GitHubCommitOperation } from "@prisma/client";
import { db } from "@/lib/db";
import { createBrowseClient, type BrowseClient } from "./browse-client";
import { BrowseError } from "./browse-error";
import { requireRepository } from "./repository-browser";
import { objectSha, safeSegment } from "./browse-policy";
import { blobSha, contentHash, importPath, newBranch, savedFiles, sourceSchema, type Source } from "./commit-policy";

export const commitInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), projectId: z.string().min(1).max(128), message: z.string().trim().min(1).max(500).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)), branch: z.union([z.literal(""), newBranch]).default("") }).strict(),
  z.object({ action: z.literal("publish"), operationId: z.string().uuid(), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("cancel"), operationId: z.string().uuid(), confirm: z.literal(true) }).strict(),
]);
type File = ReturnType<typeof savedFiles>[number] & { mode: "100644" | "100755"; originalPath: string };
type Change = { path: string; originalPath: string; kind: "added" | "modified" | "deleted"; mode: "100644" | "100755"; sha: string | null };
type Payload = { source: Source; sourceDigest: string; snapshotHash: string; templateVersion: number; files: File[]; changes: Change[];
  head: string; rootTree: string; branch: string; message: string; author: { name: string; email: string; date: string } };
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an invalid commit response.", 502);
  return result.data;
}
const basePath = (source: Source) => `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`;
const originalPath = (source: Source, path: string) => source.folder ? `${source.folder}/${path}` : path;
function payload(operation: GitHubCommitOperation): Payload { return operation.payload as unknown as Payload; }
async function ownedProject(userId: string, projectId: string) {
  const project = await db.playground.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) throw new BrowseError("OWNER_REQUIRED", "Only the project owner can review and publish GitHub changes.", 403);
  return project;
}
async function repository(client: BrowseClient, source: Source) {
  const repo = await requireRepository(client, source.owner, source.repository);
  if (repo.id !== source.repositoryId) throw new BrowseError("REPOSITORY_CHANGED", "Repository identity changed. Import the intended source again.", 409);
  if (!client.writeEnabled) throw new BrowseError("WRITE_CONSENT_REQUIRED", "Reconnect GitHub with commits enabled before publishing.", 403);
  const permission = parse(z.object({ permissions: z.object({ push: z.boolean() }), archived: z.boolean().optional(), disabled: z.boolean().optional() }), (await client.get(basePath(source))).data);
  if (!permission.permissions.push || permission.archived || permission.disabled) throw new BrowseError("WRITE_PERMISSION_REQUIRED", "This GitHub account cannot publish to this repository.", 403);
}
async function head(client: BrowseClient, source: Source) {
  const result = parse(z.object({ commit: z.object({ sha: objectSha, commit: z.object({ tree: z.object({ sha: objectSha }) }) }) }), (await client.get(`${basePath(source)}/branches/${encodeURIComponent(source.branch)}`)).data);
  return { head: result.commit.sha, rootTree: result.commit.commit.tree.sha };
}
async function selectedTree(client: BrowseClient, source: Source, rootTree: string) {
  let sha = rootTree;
  for (const segment of source.folder.split("/").filter(Boolean)) {
    const tree = parse(z.object({ sha: objectSha, truncated: z.boolean(), tree: z.array(z.object({ path: z.string().refine(safeSegment), type: z.string(), mode: z.string(), sha: objectSha })).max(5000) }), (await client.get(`${basePath(source)}/git/trees/${sha}`)).data);
    if (tree.sha !== sha || tree.truncated) throw new BrowseError("SOURCE_UNAVAILABLE", "Source folder cannot be read completely.", 422);
    const entry = tree.tree.find(item => item.path === segment && item.type === "tree" && item.mode === "040000");
    if (!entry) throw new BrowseError("SOURCE_CHANGED", "Source folder moved or was deleted. Import the current source again.", 409);
    sha = entry.sha;
  }
  return sha;
}
async function branchRef(client: BrowseClient, source: Source, branch: string) {
  try {
    const ref = parse(z.object({ ref: z.string(), object: z.object({ type: z.literal("commit"), sha: objectSha }) }), (await client.get(`${basePath(source)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`)).data);
    if (ref.ref !== `refs/heads/${branch}`) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned a different branch.", 502);
    return ref.object.sha;
  } catch (error) { if (error instanceof BrowseError && error.code === "NOT_FOUND") return null; throw error; }
}
async function beforeText(client: BrowseClient, source: Source, sha: string, size: number) {
  const blob = parse(z.object({ sha: objectSha, size: z.number().max(256 * 1024), encoding: z.literal("base64"), content: z.string().max(360000) }), (await client.get(`${basePath(source)}/git/blobs/${sha}`)).data);
  const encoded = blob.content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new BrowseError("SOURCE_CHANGED", "Invalid source encoding.", 422);
  const bytes = Buffer.from(encoded, "base64"); let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new BrowseError("SOURCE_CHANGED", "Source is no longer supported text.", 409); }
  if (blob.sha !== sha || blob.size !== size || bytes.length !== size || blobSha(text) !== sha || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new BrowseError("SOURCE_CHANGED", "Source content does not match the reviewed identity.", 409);
  return text;
}
export function operationResult(operation: GitHubCommitOperation) {
  const data = payload(operation);
  const urlBase = `https://github.com/${encodeURIComponent(data.source.owner)}/${encodeURIComponent(data.source.repository)}`;
  return { operationId: operation.id, projectId: operation.playgroundId, status: operation.status, branch: data.branch, message: data.message,
    changes: data.changes.map(({ path, kind }) => ({ path, kind })), commitSha: operation.commitSha,
    commitUrl: operation.commitSha ? `${urlBase}/commit/${operation.commitSha}` : null,
    branchUrl: `${urlBase}/tree/${data.branch.split("/").map(encodeURIComponent).join("/")}`, errorCode: operation.errorCode, uploadedFiles: operation.blobIndex,
    retryAt: operation.status === "RUNNING" ? operation.leaseUntil?.getTime() ?? null : null };
}
export async function commitStatus(userId: string, projectId: string) {
  const project = await ownedProject(userId, projectId);
  const parsed = sourceSchema.safeParse(project.githubSource);
  if (!parsed.success) return { imported: false, source: null, operation: null };
  const operations = await db.gitHubCommitOperation.findMany({ where: { playgroundId: projectId, userId, ...(project.githubCommitLock ? { id: project.githubCommitLock } : { status: { in: ["RUNNING", "RECOVERABLE", "SUCCEEDED"] } }) }, orderBy: { createdAt: "desc" }, take: 1 });
  return { imported: true, source: { owner: parsed.data.owner, repository: parsed.data.repository, branch: parsed.data.branch, folder: parsed.data.folder, commitSha: parsed.data.commitSha }, operation: operations[0] ? operationResult(operations[0]) : null };
}
async function review(userId: string, input: Extract<z.infer<typeof commitInput>, { action: "review" }>, signal: AbortSignal) {
  const project = await ownedProject(userId, input.projectId);
  if (project.githubCommitLock) throw new BrowseError("PENDING_COMMIT", "Recover the pending commit before starting a new review.", 409);
  const source = sourceSchema.safeParse(project.githubSource);
  if (!source.success) throw new BrowseError("IMPORT_REQUIRED", "This project has no supported GitHub import baseline.", 400);
  const snapshot = await db.templateFile.findUnique({ where: { playgroundId: project.id } });
  if (!snapshot) throw new BrowseError("SAVE_REQUIRED", "Save the project before reviewing changes.", 400);
  const local = savedFiles(snapshot.content), baseline = source.data, byPath = new Map(baseline.files.map(file => [file.path, file]));
  for (const file of baseline.files) if (file.originalPath !== originalPath(baseline, file.path)) throw new BrowseError("INVALID_BASELINE", "Import baseline has inconsistent paths.", 409);
  const client = await createBrowseClient(userId, signal);
  await repository(client, baseline);
  const current = await head(client, baseline), sha = await selectedTree(client, baseline, current.rootTree);
  const tree = parse(z.object({ sha: objectSha, truncated: z.boolean(), tree: z.array(z.object({ path: z.string().refine(importPath), type: z.string(), mode: z.string(), sha: objectSha, size: z.number().int().nonnegative().optional() })).max(1000) }), (await client.get(`${basePath(baseline)}/git/trees/${sha}?recursive=1`)).data);
  if (tree.sha !== sha || tree.truncated) throw new BrowseError("SOURCE_UNAVAILABLE", "Source tree exceeds review limits or is truncated. Select a smaller import.", 422);
  const remote = new Map(tree.tree.map(entry => [entry.path, entry])), locals = new Map(local.map(file => [file.path, file]));
  const changes: Change[] = [], conflicts: string[] = [];
  for (const file of baseline.files) {
    const actual = remote.get(file.path), saved = locals.get(file.path);
    if (!actual || actual.type !== "blob" || actual.mode !== file.mode || actual.sha !== file.sha) {
      if (actual?.type === "blob" && actual.mode === file.mode && saved?.sha === actual.sha) continue;
      conflicts.push(file.path); continue;
    }
    if (!saved) changes.push({ path: file.path, originalPath: file.originalPath, kind: "deleted", mode: file.mode, sha: null });
    else if (saved.sha !== actual.sha) changes.push({ path: file.path, originalPath: file.originalPath, kind: "modified", mode: file.mode, sha: saved.sha });
  }
  for (const file of local) if (!byPath.has(file.path)) {
    const entry = remote.get(file.path);
    if (baseline.omitted.some(item => item.path === file.path || file.path.startsWith(`${item.path}/`))) { conflicts.push(file.path); continue; }
    const collision = tree.tree.some(item => item.path.normalize("NFC").toLowerCase() === file.path.normalize("NFC").toLowerCase() || item.path.startsWith(`${file.path}/`) || (file.path.startsWith(`${item.path}/`) && item.type !== "tree"));
    if (entry?.type === "blob" && entry.mode === "100644" && entry.sha === file.sha) continue;
    if (collision) { conflicts.push(file.path); continue; }
    changes.push({ path: file.path, originalPath: originalPath(baseline, file.path), kind: "added", mode: "100644", sha: file.sha });
  }
  // Workflow writes need additional OAuth permissions that this app never requests.
  if (changes.some(change => change.originalPath.toLowerCase().startsWith(".github/workflows/"))) throw new BrowseError("WORKFLOW_UNSUPPORTED", "Publishing GitHub workflow changes is not supported by this connection.", 422);
  const branch = input.branch || `codex/liveide-${randomUUID().slice(0, 12)}`;
  if (branch === baseline.branch || await branchRef(client, baseline, branch)) throw new BrowseError("BRANCH_EXISTS", "Choose a new branch name. Existing branches are never updated.", 409);
  const diffs: (Change & { before: string; after: string })[] = [];
  for (let index = 0; index < changes.length; index += 4) {
    const results = await Promise.allSettled(changes.slice(index, index + 4).map(async change => {
      const entry = remote.get(change.path);
      return { ...change, before: entry ? await beforeText(client, baseline, entry.sha, entry.size!) : "", after: locals.get(change.path)?.content ?? "" };
    }));
    for (const result of results) { if (result.status === "rejected") throw result.reason; diffs.push(result.value); }
  }
  await client.assertActive(); signal.throwIfAborted();
  const result = { repository: `${baseline.owner}/${baseline.repository}`, sourceBranch: baseline.branch, folder: baseline.folder, head: current.head, branch, message: input.message, changes: diffs, conflicts, operationId: null as string | null };
  if (conflicts.length || !changes.length) return result;
  const identity = parse(z.object({ id: z.number().int().positive(), login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) }), (await client.get("/user")).data);
  const files: File[] = local.map(file => ({ ...file, mode: byPath.get(file.path)?.mode ?? "100644", originalPath: originalPath(baseline, file.path) }));
  const data: Payload = { source: baseline, sourceDigest: contentHash(JSON.stringify(project.githubSource)), snapshotHash: contentHash(snapshot.content as string), templateVersion: snapshot.version,
    files, changes, ...current, branch, message: input.message, author: { name: identity.login, email: `${identity.id}+${identity.login}@users.noreply.github.com`, date: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString() } };
  const operation = await db.gitHubCommitOperation.create({ data: { id: randomUUID(), playgroundId: project.id, userId, connectionVersion: client.version, status: "REVIEWED", payload: data,
    treeSha: null, commitSha: null, leaseOwner: null, leaseUntil: null, errorCode: null } });
  return { ...result, operationId: operation.id };
}
async function publish(userId: string, operationId: string, signal: AbortSignal) {
  const found = await db.gitHubCommitOperation.findUnique({ where: { id: operationId } });
  if (!found || found.userId !== userId) throw new BrowseError("NOT_FOUND", "Commit operation is unavailable.", 404);
  const operation = found;
  await ownedProject(userId, operation.playgroundId);
  if (operation.status === "SUCCEEDED") return operationResult(operation);
  const data = payload(operation), client = await createBrowseClient(userId, signal);
  if (!data.author.email.startsWith(`${client.githubUserId}+`) || (operation.status === "REVIEWED" && client.version !== operation.connectionVersion)) throw new BrowseError("CONNECTION_CHANGED", "Review authorization changed. Recover with the original GitHub account and commits enabled, or make a fresh review.", 409);
  await repository(client, data.source);
  if (operation.status === "REVIEWED" && operation.createdAt.getTime() + 15 * 60000 < Date.now()) throw new BrowseError("REVIEW_EXPIRED", "Review expired. Review saved changes again.", 409);
  const owner = randomUUID(), leaseUntil = new Date(Date.now() + 180000);
  await db.$transaction(async tx => {
    const project = await tx.playground.findUnique({ where: { id: operation.playgroundId } });
    const saved = await tx.templateFile.findUnique({ where: { playgroundId: operation.playgroundId } });
    if (!project || project.userId !== userId) throw new BrowseError("OWNER_REQUIRED", "Project ownership changed.", 403);
    if (contentHash(JSON.stringify(project.githubSource)) !== data.sourceDigest) throw new BrowseError("SOURCE_CHANGED", "Source baseline changed. Review again.", 409);
    if (operation.status === "REVIEWED" && (!saved || saved.version !== data.templateVersion || typeof saved.content !== "string" || contentHash(saved.content) !== data.snapshotHash)) throw new BrowseError("PROJECT_CHANGED", "Saved project changed after review. Review again.", 409);
    const locked = await tx.playground.updateMany({ where: { id: project.id, userId, OR: [{ githubCommitLock: null }, { githubCommitLock: { isSet: false } }, { githubCommitLock: operation.id }] }, data: { githubCommitLock: operation.id } });
    if (locked.count !== 1) throw new BrowseError("PENDING_COMMIT", "Another commit needs recovery first.", 409);
    const claimed = await tx.gitHubCommitOperation.updateMany({ where: { id: operation.id, userId, status: { in: ["REVIEWED", "RECOVERABLE", "RUNNING"] }, OR: [{ leaseUntil: null }, { leaseUntil: { isSet: false } }, { leaseUntil: { lt: new Date() } }] }, data: { status: "RUNNING", leaseOwner: owner, leaseUntil, errorCode: null, connectionVersion: client.version } });
    if (claimed.count !== 1) throw new BrowseError("COMMIT_RUNNING", "Commit is already running. Check its status before retrying.", 409);
  });
  async function active() {
    signal.throwIfAborted(); await client.assertActive();
    const state = await db.gitHubCommitOperation.findUnique({ where: { id: operation.id } });
    if (state?.status !== "RUNNING" || state.leaseOwner !== owner || !state.leaseUntil || state.leaseUntil <= new Date()) throw new BrowseError("LEASE_CHANGED", "Commit worker changed. Check operation status.", 409);
  }
  async function save(update: { treeSha?: string; commitSha?: string; blobIndex?: number }) {
    await active();
    const saved = await db.gitHubCommitOperation.updateMany({ where: { id: operation.id, leaseOwner: owner, status: "RUNNING" }, data: update });
    if (saved.count !== 1) throw new BrowseError("LEASE_CHANGED", "Commit worker changed. Check operation status.", 409);
    Object.assign(operation, update);
  }
  async function post(suffix: string, body: unknown) { await active(); return (await client.post(`${basePath(data.source)}/git/${suffix}`, body)).data; }
  try {
    if (!operation.commitSha) {
      const current = await head(client, data.source);
      if (current.head !== data.head) throw new BrowseError("SOURCE_CHANGED", "Source branch advanced after review. Recovering this operation will not overwrite it.", 409);
      if (await branchRef(client, data.source, data.branch)) throw new BrowseError("BRANCH_EXISTS", "Destination branch already exists. It will not be changed.", 409);
      if (!operation.treeSha) {
        const blobs = data.changes.filter(change => change.sha);
        for (let index = operation.blobIndex; index < blobs.length; index++) {
          const change = blobs[index];
          const file = data.files.find(file => file.path === change.path)!;
          const blob = parse(z.object({ sha: objectSha }), await post("blobs", { content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" }));
          if (blob.sha !== file.sha) throw new BrowseError("PROVIDER_RESPONSE", "Created blob does not match reviewed content.", 502);
          await save({ blobIndex: index + 1 });
        }
        const tree = parse(z.object({ sha: objectSha }), await post("trees", { base_tree: data.rootTree, tree: data.changes.map(change => ({ path: change.originalPath, mode: change.mode, type: "blob", sha: change.sha })) }));
        await save({ treeSha: tree.sha });
      }
      const commit = parse(z.object({ sha: objectSha, tree: z.object({ sha: objectSha }), parents: z.array(z.object({ sha: objectSha })) }), await post("commits", { message: data.message, tree: operation.treeSha, parents: [data.head], author: data.author, committer: data.author }));
      if (commit.tree.sha !== operation.treeSha || commit.parents.length !== 1 || commit.parents[0].sha !== data.head) throw new BrowseError("PROVIDER_RESPONSE", "Created commit differs from reviewed source.", 502);
      await save({ commitSha: commit.sha });
    }
    const existing = await branchRef(client, data.source, data.branch);
    if (existing && existing !== operation.commitSha) throw new BrowseError("BRANCH_EXISTS", "Destination branch points to another commit. It will not be changed.", 409);
    if (!existing) {
      if ((await head(client, data.source)).head !== data.head) throw new BrowseError("SOURCE_CHANGED", "Source branch advanced after review. Publishing is paused for recovery.", 409);
      try { await post("refs", { ref: `refs/heads/${data.branch}`, sha: operation.commitSha }); }
      catch (error) { if (await branchRef(client, data.source, data.branch) !== operation.commitSha) throw error; }
    }
    if (await branchRef(client, data.source, data.branch) !== operation.commitSha) throw new BrowseError("PUBLISH_UNCERTAIN", "Branch publication could not be verified. Retry recovery.", 503);
    const sha = await selectedTree(client, data.source, operation.treeSha!);
    const baseline: Source = { ...data.source, branch: data.branch, commitSha: operation.commitSha!, rootTreeSha: operation.treeSha!, treeSha: sha,
      files: data.files.map(file => ({ path: file.path, originalPath: file.originalPath, sha: file.sha, mode: file.mode, size: file.size, contentHash: file.contentHash })) };
    await active();
    await db.$transaction(async tx => {
      const finished = await tx.gitHubCommitOperation.updateMany({ where: { id: operation.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "SUCCEEDED", leaseOwner: null, leaseUntil: null, errorCode: null } });
      if (finished.count !== 1) throw new BrowseError("LEASE_CHANGED", "Commit worker changed. Recover the published result.", 409);
      const updated = await tx.playground.updateMany({ where: { id: operation.playgroundId, userId, githubCommitLock: operation.id }, data: { githubSource: baseline, githubCommitLock: null } });
      if (updated.count !== 1) throw new BrowseError("PROJECT_CHANGED", "Project changed. Recover the published result.", 409);
    });
    return operationResult({ ...operation, status: "SUCCEEDED", errorCode: null, leaseUntil: null });
  } catch (error) {
    const code = error instanceof BrowseError ? error.code : "COMMIT_UNAVAILABLE";
    await db.gitHubCommitOperation.updateMany({ where: { id: operation.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "RECOVERABLE", leaseOwner: null, leaseUntil: null, errorCode: code } });
    const current = await db.gitHubCommitOperation.findUnique({ where: { id: operation.id } });
    if (!current) throw error;
    return { ...operationResult(current), error: error instanceof BrowseError ? error.message : "Commit was interrupted. Recover the recorded operation safely.", ...(error instanceof BrowseError && error.retryAt ? { retryAt: error.retryAt } : {}) };
  }
}
async function cancel(userId: string, operationId: string, signal: AbortSignal) {
  const operation = await db.gitHubCommitOperation.findUnique({ where: { id: operationId } });
  if (!operation || operation.userId !== userId) throw new BrowseError("NOT_FOUND", "Commit operation unavailable.", 404);
  await ownedProject(userId, operation.playgroundId);
  if (operation.status === "SUCCEEDED") throw new BrowseError("ALREADY_PUBLISHED", "This commit was published. Recovery retains its result; cancellation never deletes a branch.", 409);
  if (operation.status === "CANCELLED") return operationResult(operation);
  const client = await createBrowseClient(userId, signal), data = payload(operation);
  const repo = await requireRepository(client, data.source.owner, data.source.repository);
  if (repo.id !== data.source.repositoryId) throw new BrowseError("REPOSITORY_CHANGED", "Repository identity changed.", 409);
  // Expired workers carry an aborted deadline, so they cannot publish after this check.
  if (operation.leaseUntil && operation.leaseUntil > new Date()) throw new BrowseError("COMMIT_RUNNING", "Wait for the running operation before abandoning it.", 409);
  const ref = await branchRef(client, data.source, data.branch);
  if (operation.commitSha && ref === operation.commitSha) throw new BrowseError("ALREADY_PUBLISHED", "The reviewed commit is published. Recover it to finish saving the baseline.", 409);
  await client.assertActive(); signal.throwIfAborted();
  await db.$transaction(async tx => {
    const cancelled = await tx.gitHubCommitOperation.updateMany({ where: { id: operation.id, userId, status: { in: ["REVIEWED", "RECOVERABLE", "RUNNING"] }, OR: [{ leaseUntil: null }, { leaseUntil: { isSet: false } }, { leaseUntil: { lt: new Date() } }] }, data: { status: "CANCELLED", leaseOwner: null, leaseUntil: null } });
    if (cancelled.count !== 1) throw new BrowseError("COMMIT_RUNNING", "Operation changed. Refresh its status.", 409);
    await tx.playground.updateMany({ where: { id: operation.playgroundId, userId, githubCommitLock: operation.id }, data: { githubCommitLock: null } });
  });
  return operationResult({ ...operation, status: "CANCELLED", leaseUntil: null });
}
export async function projectCommit(userId: string, input: z.infer<typeof commitInput>, signal?: AbortSignal) {
  const deadline = AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
  return input.action === "review" ? review(userId, input, deadline) : input.action === "cancel" ? cancel(userId, input.operationId, deadline) : publish(userId, input.operationId, deadline);
}

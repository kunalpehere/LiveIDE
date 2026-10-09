import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateProjectResources } from "@/lib/resource-limits";
import { AppError } from "@/lib/errors";
import { DEFAULT_TEMPLATE_LIMITS as limits, templateFolderSchema, type TemplateFolder } from "@/features/playground/libs/path-to-json";
import { githubConfiguration } from "./config";
import { BrowseError } from "./browse-error";
import { createBrowseClient, type BrowseClient } from "./browse-client";
import { readCursor } from "./browse-cursor";
import { fileRestriction, objectSha, safePath } from "./browse-policy";
import { requireRepository } from "./repository-browser";

export const importInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), cursor: z.string().min(1).max(8192), title: z.string().trim().min(1).max(100) }).strict(),
  z.object({ action: z.literal("create"), plan: z.string().min(1).max(16384), acceptOmissions: z.boolean() }).strict(),
]);
const planSchema = z.object({ id: z.string().uuid(), cursor: z.string().max(8192), title: z.string().min(1).max(100), digest: z.string().regex(/^[a-f0-9]{64}$/), version: z.string() });
const entrySchema = z.object({ path: safePath.refine(Boolean), sha: objectSha, mode: z.string(), type: z.enum(["tree", "blob", "commit"]), size: z.number().int().nonnegative().optional() });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const key = () => createHmac("sha256", Buffer.from(githubConfiguration().encryptionKey, "hex")).update("liveide-github-import:v1").digest();
function fail(message: string, code = "IMPORT_LIMIT") : never { throw new BrowseError(code, message, 422); }
function provider<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an invalid import source.", 502);
  return parsed.data;
}
async function textBlob(client: BrowseClient, base: string, entry: z.infer<typeof entrySchema>) {
  const blob = provider(z.object({ sha: objectSha, size: z.number().int().nonnegative().max(limits.maxFileSize), encoding: z.literal("base64"), content: z.string().max(360_000) }), (await client.get(`${base}/git/blobs/${entry.sha}`)).data);
  const encoded = blob.content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("GitHub returned invalid file encoding.", "PROVIDER_RESPONSE");
  const bytes = Buffer.from(encoded, "base64");
  const gitSha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob.sha !== entry.sha || blob.size !== entry.size || bytes.length !== blob.size || gitSha !== entry.sha) fail("File content does not match its Git object identity.", "SOURCE_CHANGED");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return { reason: "Binary or invalid UTF-8 text" } as const; }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) return { reason: "Binary content" } as const;
  if (content.startsWith("version https://git-lfs.github.com/spec/v1")) return { reason: "Git LFS pointer (asset is not stored in Git)" } as const;
  return { content, contentHash: hash(content) };
}
function addFile(root: TemplateFolder, path: string, content: string) {
  const segments = path.split("/"); let folder = root;
  for (const name of segments.slice(0, -1)) {
    let next = folder.items.find(item => "folderName" in item && item.folderName === name) as TemplateFolder | undefined;
    if (!next) { next = { folderName: name, items: [] }; folder.items.push(next); }
    folder = next;
  }
  const name = segments.at(-1)!;
  const dot = name.lastIndexOf("."), extension = name.slice(dot + 1);
  const split = dot > 0 && /^[a-zA-Z0-9_-]{1,32}$/.test(extension);
  folder.items.push({ filename: split ? name.slice(0, dot) : name, fileExtension: split ? extension : "", content });
}
function templateFor(root: TemplateFolder): "NEXTJS" | "REACT" | "VUE" | "ANGULAR" | "HONO" | "EXPRESS" {
  const file = root.items.find(item => "filename" in item && item.filename === "package" && item.fileExtension === "json");
  if (file && "content" in file) {
    try {
      const pkg = JSON.parse(file.content), deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return "NEXTJS";
      if (deps.vue) return "VUE";
      if (deps["@angular/core"]) return "ANGULAR";
      if (deps.hono) return "HONO";
      if (deps.express) return "EXPRESS";
    } catch { /* Content remains unchanged even when package.json is invalid. */ }
  }
  return "REACT";
}
async function collect(client: BrowseClient, cursor: string) {
  const source = await readCursor(client, cursor, "directory");
  const repo = await requireRepository(client, source.owner, source.repo);
  const base = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  const tree = provider(z.object({ sha: objectSha, truncated: z.boolean(), tree: z.array(entrySchema).max(1000) }), (await client.get(`${base}/git/trees/${source.sha}?recursive=1`)).data);
  if (tree.sha !== source.sha) fail("GitHub returned a different source tree.", "SOURCE_CHANGED");
  if (tree.truncated) fail("GitHub truncated this source tree. Select a smaller folder.");
  const entries = tree.tree.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const identities = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (parts.length > limits.maxDepth + 1 || parts.some(part => /^(\.git|\.liveide)$/i.test(part) || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail("Source contains a reserved, unsafe, or excessively deep path.", "UNSAFE_PATH");
    const identity = entry.path.normalize("NFC").toLowerCase();
    if (identities.has(identity)) fail("Source contains duplicate or case-colliding paths.", "UNSAFE_PATH");
    identities.set(identity, entry);
  }
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = identities.get(parts.slice(0, i).join("/").normalize("NFC").toLowerCase());
      if (!parent || parent.path !== parts.slice(0, i).join("/") || parent.type !== "tree" || parent.mode !== "040000") fail("Source contains conflicting or missing parent directories.", "UNSAFE_PATH");
    }
  }
  const candidates: typeof entries = [];
  const omitted: { path: string; sha: string; mode: string; reason: string }[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (entry.type === "tree" && entry.mode === "040000") continue;
    if (entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && (entry.size === undefined || entry.size > limits.maxFileSize)) fail("A file exceeds 256 KiB or has no known size. Select a smaller folder.");
    const reason = entry.type !== "blob" ? "Submodule or unsupported Git entry" : fileRestriction(entry.path, entry.size ?? null, entry.mode);
    if (reason) omitted.push({ path: entry.path, sha: entry.sha, mode: entry.mode, reason });
    else { candidates.push(entry); bytes += entry.size!; }
  }
  if (candidates.length > limits.maxFiles || bytes > limits.maxTotalSize) fail("Import exceeds 250 text files or 2 MiB. Select a smaller folder.");
  const root: TemplateFolder = { folderName: "Root", items: [] };
  const files: { path: string; originalPath: string; sha: string; mode: string; size: number; contentHash: string }[] = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = candidates.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map(entry => textBlob(client, base, entry)));
    for (let j = 0; j < results.length; j++) {
      const result = results[j], entry = batch[j];
      if (result.status === "rejected") throw result.reason;
      if ("reason" in result.value) { omitted.push({ path: entry.path, sha: entry.sha, mode: entry.mode, reason: result.value.reason! }); continue; }
      addFile(root, entry.path, result.value.content);
      files.push({ path: entry.path, originalPath: source.path ? `${source.path}/${entry.path}` : entry.path, sha: entry.sha, mode: entry.mode, size: entry.size!, contentHash: result.value.contentHash });
    }
  }
  if (!files.length) fail("This source has no supported text files to import.", "EMPTY_IMPORT");
  templateFolderSchema.parse(root);
  try { validateProjectResources(root); } catch (error) {
    if (error instanceof AppError) throw new BrowseError(error.code, error.message + " Select a smaller folder.", 422);
    throw error;
  }
  const serialized = JSON.stringify(root);
  omitted.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const metadata = { schemaVersion: 1, provider: "github", repositoryId: repo.id, owner: repo.owner.login, repository: repo.name, branch: source.branch,
    commitSha: source.commitSha, rootTreeSha: source.rootTreeSha, treeSha: source.sha, folder: source.path, files, omitted };
  await client.assertActive();
  return { serialized, metadata, digest: hash(JSON.stringify(metadata)), template: templateFor(root), bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

export async function importRepository(userId: string, input: z.infer<typeof importInput>, signal?: AbortSignal) {
  const deadline = AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]);
  const client = await createBrowseClient(userId, deadline);
  if (input.action === "review") {
    const result = await collect(client, input.cursor);
    const plan = await new SignJWT({ id: randomUUID(), cursor: input.cursor, title: input.title, digest: result.digest, version: client.version })
      .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer("liveide-github-import").setAudience("github-import").setIssuedAt().setExpirationTime("15m").sign(key());
    return { plan, title: input.title, fileCount: result.metadata.files.length, bytes: result.bytes, omitted: result.metadata.omitted,
      folder: result.metadata.folder, commitSha: result.metadata.commitSha, template: result.template };
  }
  let plan: z.infer<typeof planSchema>;
  try {
    const { payload } = await jwtVerify(input.plan, key(), { algorithms: ["HS256"], issuer: "liveide-github-import", audience: "github-import", subject: userId });
    plan = planSchema.parse(payload);
    if (plan.version !== client.version) throw new Error();
  } catch { throw new BrowseError("INVALID_IMPORT_PLAN", "Import review expired or connection changed. Review this source again.", 400); }
  const existing = await db.playground.findUnique({ where: { id: plan.id } });
  if (existing) {
    if (existing.userId !== userId) throw new BrowseError("IMPORT_CONFLICT", "Import identity conflict. Review again.", 409);
    await client.assertActive();
    return { projectId: existing.id, title: existing.title };
  }
  const result = await collect(client, plan.cursor);
  if (result.digest !== plan.digest) throw new BrowseError("SOURCE_CHANGED", "Source differs from your review. Review again before importing.", 409);
  if (result.metadata.omitted.length && !input.acceptOmissions) throw new BrowseError("OMISSIONS_NOT_ACCEPTED", "Confirm the omitted files before importing.", 400);
  deadline.throwIfAborted();
  // All reads and validation finish first. Nested create stores project, source and files atomically.
  // A signed project ID is also the durable idempotency key for concurrent/retried requests.
  try {
    const project = await db.$transaction(async tx => {
      // Lock the authorization version inside the same short transaction as persistence.
      const connection = await tx.gitHubConnection.findUnique({ where: { userId } });
      if (!connection?.encryptedToken || connection.version !== client.version) throw new BrowseError("CONNECTION_CHANGED", "GitHub connection changed. Review the source again.", 409);
      const locked = await tx.gitHubConnection.updateMany({ where: { userId, version: client.version, encryptedToken: connection.encryptedToken }, data: { version: client.version } });
      if (locked.count !== 1) throw new BrowseError("CONNECTION_CHANGED", "GitHub connection changed. Review the source again.", 409);
      deadline.throwIfAborted();
      return tx.playground.create({ data: { id: plan.id, userId, title: plan.title,
      description: `Imported from ${result.metadata.owner}/${result.metadata.repository}`,
      template: result.template, githubSource: { ...result.metadata, importedAt: new Date().toISOString() },
      templateFiles: { create: [{ content: result.serialized }] } } });
    });
    return { projectId: project.id, title: project.title };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const project = await db.playground.findUnique({ where: { id: plan.id } });
      if (project?.userId === userId) return { projectId: project.id, title: project.title };
    }
    throw error;
  }
}

import "server-only";
import { z } from "zod";
import { BrowseError } from "./browse-error";
import { createBrowseClient, type BrowseClient } from "./browse-client";
import { readCursor, signCursor } from "./browse-cursor";
import { branchName, fileRestriction, MAX_FILE_BYTES, objectSha, ownerName, PAGE_SIZE, pageNumber, repositoryName, safePath, safeSegment, TREE_PAGE_SIZE } from "./browse-policy";
import type { Branch, Directory, FilePreview, Page, Repository, TreeEntry } from "@/features/github/types";

export const browseInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("repositories"), page: pageNumber }).strict(),
  z.object({ action: z.literal("branches"), owner: ownerName, repo: repositoryName, page: pageNumber }).strict(),
  z.object({ action: z.literal("tree"), owner: ownerName, repo: repositoryName, branch: branchName }).strict(),
  z.object({ action: z.literal("directory"), cursor: z.string().min(1).max(8192), page: pageNumber }).strict(),
  z.object({ action: z.literal("file"), cursor: z.string().min(1).max(8192) }).strict(),
]);
const repositorySchema = z.object({ id: z.number().int().positive(), name: repositoryName, owner: z.object({ login: ownerName }), private: z.boolean(),
  description: z.string().max(10_000).nullable(), default_branch: branchName.nullable() });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an unsupported response.", 502);
  return result.data;
}
function projectRepository(item: z.infer<typeof repositorySchema>): Repository {
  return { id: item.id, owner: item.owner.login, name: item.name, private: item.private, description: item.description?.slice(0, 500) ?? null, defaultBranch: item.default_branch };
}
const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
export async function requireRepository(client: BrowseClient, owner: string, repo: string) {
  const item = parse(repositorySchema, (await client.get(repoPath(owner, repo))).data);
  if (item.private && client.access !== "private") throw new BrowseError("PRIVATE_ACCESS_REQUIRED", "Reconnect GitHub with private repository access to browse this repository.", 403);
  if (item.owner.login.toLowerCase() !== owner.toLowerCase() || item.name.toLowerCase() !== repo.toLowerCase()) throw new BrowseError("REPOSITORY_CHANGED", "Repository moved or changed. Refresh the repository list.", 409);
  return item;
}
async function directory(client: BrowseClient, context: { owner: string; repo: string; branch: string; path: string; sha: string; commitSha: string; rootTreeSha: string }, page: number): Promise<Directory> {
  const response = await client.get(`${repoPath(context.owner, context.repo)}/git/trees/${encodeURIComponent(context.sha)}`);
  if (response.data && typeof response.data === "object" && "tree" in response.data && Array.isArray(response.data.tree) && response.data.tree.length > 5000) throw new BrowseError("DIRECTORY_TOO_LARGE", "This directory exceeds the 5,000-entry browsing limit.", 422);
  const tree = parse(z.object({ sha: objectSha, truncated: z.boolean(), tree: z.array(z.object({ path: z.string().refine(safeSegment), mode: z.string(), type: z.enum(["tree", "blob", "commit"]), sha: objectSha, size: z.number().int().nonnegative().optional() })).max(5000) }), response.data);
  if (tree.sha !== context.sha) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned a different source tree.", 502);
  if (tree.truncated) throw new BrowseError("DIRECTORY_TOO_LARGE", "GitHub truncated this directory. It cannot be browsed completely here.", 422);
  const sorted = tree.tree.sort((a, b) => Number(b.type === "tree") - Number(a.type === "tree") || a.path.localeCompare(b.path));
  const items = await Promise.all(sorted.slice((page - 1) * TREE_PAGE_SIZE, page * TREE_PAGE_SIZE).map(async entry => {
    const path = context.path ? `${context.path}/${entry.path}` : entry.path;
    const pathAllowed = safePath.safeParse(path).success;
    const kind: TreeEntry["kind"] = entry.type === "tree" && entry.mode === "040000" ? "directory" : entry.type === "blob" && ["100644", "100755"].includes(entry.mode) ? "file" : "unsupported";
    const size = entry.size ?? null;
    const restriction = !pathAllowed ? "Path exceeds the browsing limit." : kind === "directory" ? null : fileRestriction(path, size, entry.mode);
    const cursor = kind !== "unsupported" && !restriction ? await signCursor(client, { ...context, sha: entry.sha, path, kind, size }) : null;
    return { name: entry.path, path, kind, size, restriction, cursor };
  }));
  return { items, page, hasNext: page * TREE_PAGE_SIZE < sorted.length, path: context.path, branch: context.branch, treeSha: tree.sha,
    cursor: await signCursor(client, { ...context, sha: tree.sha, kind: "directory", size: null }) };
}

export async function browseRepositories(userId: string, input: z.infer<typeof browseInput>, signal?: AbortSignal): Promise<Page<Repository> | Page<Branch> | Directory | FilePreview> {
  const client = await createBrowseClient(userId, signal);
  let result: Page<Repository> | Page<Branch> | Directory | FilePreview;
  if (input.action === "repositories") {
    const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(input.page), sort: "updated", direction: "desc", visibility: client.access === "private" ? "all" : "public", affiliation: "owner,collaborator,organization_member" });
    const response = await client.get(`/user/repos?${query}`);
    const repositories = parse(z.array(repositorySchema).max(PAGE_SIZE), response.data);
    result = { items: repositories.filter(item => client.access === "private" || !item.private).map(projectRepository), page: input.page, hasNext: response.hasNext };
  } else if (input.action === "branches") {
    await requireRepository(client, input.owner, input.repo);
    const response = await client.get(`${repoPath(input.owner, input.repo)}/branches?per_page=${PAGE_SIZE}&page=${input.page}`);
    const branches = parse(z.array(z.object({ name: branchName, protected: z.boolean() })).max(PAGE_SIZE), response.data);
    result = { items: branches, page: input.page, hasNext: response.hasNext };
  } else if (input.action === "tree") {
    await requireRepository(client, input.owner, input.repo);
    const branch = parse(z.object({ commit: z.object({ sha: objectSha, commit: z.object({ tree: z.object({ sha: objectSha }) }) }) }),
      (await client.get(`${repoPath(input.owner, input.repo)}/branches/${encodeURIComponent(input.branch)}`)).data);
    result = await directory(client, { owner: input.owner, repo: input.repo, branch: input.branch, path: "", sha: branch.commit.commit.tree.sha, commitSha: branch.commit.sha, rootTreeSha: branch.commit.commit.tree.sha }, 1);
  } else {
    const cursor = await readCursor(client, input.cursor, input.action === "directory" ? "directory" : "file");
    await requireRepository(client, cursor.owner, cursor.repo);
    if (input.action === "directory") result = await directory(client, cursor, input.page);
    else {
      const restriction = fileRestriction(cursor.path, cursor.size, "100644");
      if (restriction) throw new BrowseError("UNSUPPORTED_FILE", restriction, 422);
      const blob = parse(z.object({ sha: objectSha, size: z.number().int().nonnegative().max(MAX_FILE_BYTES), encoding: z.literal("base64"), content: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 10_000) }),
        (await client.get(`${repoPath(cursor.owner, cursor.repo)}/git/blobs/${cursor.sha}`)).data);
      const encoded = blob.content.replace(/\s/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new BrowseError("UNSUPPORTED_FILE", "GitHub returned an invalid file encoding.", 422);
      const bytes = Buffer.from(encoded, "base64");
      if (blob.sha !== cursor.sha || blob.size !== cursor.size || bytes.length !== blob.size || bytes.length > MAX_FILE_BYTES) throw new BrowseError("UNSUPPORTED_FILE", "File size or identity does not match its source tree.", 422);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new BrowseError("BINARY_FILE", "This file is binary or is not valid UTF-8 text.", 422); }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new BrowseError("BINARY_FILE", "Binary files cannot be previewed as source text.", 422);
      if (content.startsWith("version https://git-lfs.github.com/spec/v1")) throw new BrowseError("LFS_FILE", "Git LFS files cannot be previewed here.", 422);
      result = { path: cursor.path, branch: cursor.branch, sha: blob.sha, size: blob.size, content };
    }
  }
  // Disconnect or reauthorization during a provider request invalidates its response.
  await client.assertActive();
  return result;
}

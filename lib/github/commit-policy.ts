import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_TEMPLATE_LIMITS as limits, templateFolderSchema, type TemplateFolder } from "@/features/playground/libs/path-to-json";
import { branchName, objectSha, ownerName, repositoryName, safePath } from "./browse-policy";
import { BrowseError } from "./browse-error";
import { validateProjectResources } from "@/lib/resource-limits";
import { AppError } from "@/lib/errors";

export const contentHash = (content: string) => createHash("sha256").update(content).digest("hex");
export const blobSha = (content: string) => { const bytes = Buffer.from(content, "utf8"); return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); };
export function importPath(path: string) {
  return path !== "" && safePath.safeParse(path).success && path.split("/").length <= limits.maxDepth + 1 && path.split("/").every(part =>
    !/^(\.git|\.liveide)$/i.test(part) && !/[<>:"|?*]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export const newBranch = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_/-][A-Za-z0-9_./-]*$/).refine(value =>
  !value.includes("..") && !value.includes("//") && value.split("/").every(part => !!part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock")));
const sourceFile = z.object({ path: z.string().refine(importPath), originalPath: safePath.refine(Boolean), sha: objectSha, mode: z.enum(["100644", "100755"]), size: z.number().int().nonnegative(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const sourceSchema = z.object({ schemaVersion: z.literal(1), provider: z.literal("github"), repositoryId: z.number().int().positive(), owner: ownerName,
  repository: repositoryName, branch: branchName, commitSha: objectSha, rootTreeSha: objectSha, treeSha: objectSha, folder: safePath,
  files: z.array(sourceFile).min(1).max(limits.maxFiles), omitted: z.array(z.object({ path: safePath.refine(Boolean), sha: objectSha, mode: z.string(), reason: z.string() })).max(1000), importedAt: z.string() });
export type Source = z.infer<typeof sourceSchema>;
export function savedFiles(serialized: unknown) {
  let root: TemplateFolder;
  try { const checked = validateProjectResources(serialized); root = templateFolderSchema.parse(checked.root); }
  catch (error) { throw new BrowseError("INVALID_PROJECT", error instanceof AppError ? error.message : "Saved project tree is invalid.", 422); }
  const files: { path: string; content: string; sha: string; size: number; contentHash: string }[] = [], names = new Set<string>();
  let total = 0, entries = 0;
  function walk(folder: TemplateFolder, prefix = "", depth = 0) {
    if (depth > limits.maxDepth) throw new BrowseError("INVALID_PROJECT", "Project nesting exceeds the import limit.", 422);
    for (const item of folder.items) {
      if (++entries > 1000) throw new BrowseError("INVALID_PROJECT", "Project has too many entries.", 422);
      const name = "folderName" in item ? item.folderName : item.filename + (item.fileExtension ? `.${item.fileExtension}` : "");
      const path = prefix ? `${prefix}/${name}` : name, identity = path.normalize("NFC").toLowerCase();
      if (!importPath(path) || names.has(identity)) throw new BrowseError("UNSAFE_PATH", "Project contains unsafe or colliding paths.", 422);
      names.add(identity);
      if ("folderName" in item) walk(item, path, depth + 1);
      else {
        const size = Buffer.byteLength(item.content, "utf8"); total += size;
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item.content) || item.content.startsWith("version https://git-lfs.github.com/spec/v1") || Buffer.from(item.content).toString("utf8") !== item.content) throw new BrowseError("INVALID_PROJECT", "Project contains unsupported text, binary, or LFS content.", 422);
        if (size > limits.maxFileSize || total > limits.maxTotalSize || files.length >= limits.maxFiles) throw new BrowseError("INVALID_PROJECT", "Project exceeds the import limits.", 422);
        files.push({ path, content: item.content, sha: blobSha(item.content), size, contentHash: contentHash(item.content) });
      }
    }
  }
  walk(root);
  if (!files.length) throw new BrowseError("EMPTY_PROJECT", "An empty project cannot be published.", 422);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

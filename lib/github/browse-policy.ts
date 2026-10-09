import { z } from "zod";
import { RESOURCE_LIMITS } from "@/lib/resource-limits";

export const PAGE_SIZE = 30;
export const TREE_PAGE_SIZE = 50;
export const MAX_FILE_BYTES = RESOURCE_LIMITS.fileBytes;
export const ownerName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/);
export const repositoryName = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).refine(name => name !== "." && name !== "..");
export const branchName = z.string().min(1).max(255).refine(name => !/[\x00-\x1f\x7f\\]/.test(name));
export const pageNumber = z.coerce.number().int().min(1).max(10_000).default(1);
export const objectSha = z.string().regex(/^[a-f0-9]{40}$/);
export function safeSegment(name: string) {
  return !!name && name !== "." && name !== ".." && name.length <= 255 && !/[\/\\\x00-\x1f\x7f]/.test(name);
}
export const safePath = z.string().max(2048).refine(path => path === "" || (path.split("/").length <= 32 && path.split("/").every(safeSegment)));
const extensions = new Set("js jsx ts tsx mjs cjs json jsonc md mdx txt html htm css scss sass less vue svelte yaml yml toml xml svg sql graphql gql sh bash ini conf cfg py rb php java c cpp h hpp cs go rs swift kt kts dart r env properties csv tsv lock map".split(" "));
const names = new Set(["Dockerfile", "Containerfile", "Makefile", "LICENSE", "LICENCE", "NOTICE", "README", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc", ".env", ".env.example", ".env.local", ".env.sample"]);
export function fileRestriction(path: string, size: number | null, mode: string) {
  if (!["100644", "100755"].includes(mode)) return "Symlinks and submodules cannot be previewed.";
  if (size === null || size > MAX_FILE_BYTES) return "File exceeds the 256 KiB preview limit or has no known size.";
  const name = path.split("/").at(-1)!;
  if (!names.has(name) && !extensions.has(name.split(".").at(-1)!.toLowerCase())) return "This file type is not supported for text preview.";
  return null;
}

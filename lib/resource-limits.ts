import { AppError } from "./errors";

export const RESOURCE_LIMITS = {
  fileBytes: 256 * 1024,
  projectBytes: 2 * 1024 * 1024,
  projectJsonBytes: 3 * 1024 * 1024,
  files: 250,
  folders: 500,
  depth: 20,
  snapshots: 50,
  chatRequestBytes: 32_000,
  chatMessageBytes: 64 * 1024,
  chatMessages: 100,
  checkpointBytes: 2 * 1024 * 1024,
  checkpointProjectBytes: 8 * 1024 * 1024,
  checkpoints: 251,
} as const;

export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function exceeded(code: string, message: string): never {
  throw new AppError(code, message, 413);
}

/** Iterative validation bounds depth before recursive schemas can overflow. */
export function validateProjectResources(value: unknown) {
  let root = value;
  if (typeof root === "string") {
    if (utf8Bytes(root) > RESOURCE_LIMITS.projectJsonBytes) exceeded("PROJECT_SIZE_LIMIT", "Project JSON exceeds 3 MiB. Remove files or reduce their content before saving.");
    try { root = JSON.parse(root); } catch { throw new AppError("INVALID_PROJECT_CONTENT", "Project content must be a valid file tree.", 400); }
  }
  const pending = [{ node: root, depth: 0 }];
  let files = 0, folders = 0, bytes = 0;
  const seen = new Set<object>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== "object" || seen.has(node)) throw new AppError("INVALID_PROJECT_CONTENT", "Project content must be a valid file tree without cycles.", 400);
    seen.add(node);
    const folderEntry = "folderName" in node || "items" in node;
    const fileEntry = "filename" in node || "fileExtension" in node || "content" in node;
    if (folderEntry && fileEntry) throw new AppError("INVALID_PROJECT_CONTENT", "Project entries must be either folders or text files. Remove conflicting fields before saving.", 400);
    if ("items" in node && Array.isArray(node.items) && "folderName" in node && typeof node.folderName === "string") {
      if (++folders > RESOURCE_LIMITS.folders) exceeded("FOLDER_COUNT_LIMIT", "Project exceeds 500 folders. Remove unused folders before saving.");
      if (depth > RESOURCE_LIMITS.depth) exceeded("FOLDER_DEPTH_LIMIT", "Project exceeds 20 folder levels. Move nested folders closer to the root.");
      if (node.items.length > RESOURCE_LIMITS.files + RESOURCE_LIMITS.folders) exceeded("PROJECT_COUNT_LIMIT", "Project has too many entries. Remove unused files or folders.");
      for (const child of node.items) pending.push({ node: child, depth: depth + 1 });
    } else if ("content" in node && typeof node.content === "string" && "filename" in node && typeof node.filename === "string" && "fileExtension" in node && typeof node.fileExtension === "string") {
      if (++files > RESOURCE_LIMITS.files) exceeded("FILE_COUNT_LIMIT", "Project exceeds 250 files. Remove unused files before saving.");
      const size = utf8Bytes(node.content);
      if (size > RESOURCE_LIMITS.fileBytes) exceeded("FILE_SIZE_LIMIT", `File ${node.filename} exceeds 256 KiB. Reduce its content or remove it before saving.`);
      bytes += size;
      if (bytes > RESOURCE_LIMITS.projectBytes) exceeded("PROJECT_SIZE_LIMIT", "Project content exceeds 2 MiB. Remove files or reduce their content before saving.");
    } else throw new AppError("INVALID_PROJECT_CONTENT", "Project content must contain folders and text files.", 400);
  }
  let serialized: string;
  try { serialized = JSON.stringify(root); } catch { throw new AppError("INVALID_PROJECT_CONTENT", "Project content must be valid JSON.", 400); }
  if (utf8Bytes(serialized) > RESOURCE_LIMITS.projectJsonBytes) exceeded("PROJECT_SIZE_LIMIT", "Project JSON exceeds 3 MiB. Reduce file metadata or content before saving.");
  return { files, bytes, root };
}

/** Reads incrementally; works even when Content-Length is missing or false. */
export async function readLimitedBody(request: Pick<Request, "headers" | "body">, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) exceeded("REQUEST_TOO_LARGE", `Request exceeds ${maxBytes} bytes. Send less content and retry.`);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0, result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        exceeded("REQUEST_TOO_LARGE", `Request exceeds ${maxBytes} bytes. Send less content and retry.`);
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

export function assertChatMessage(content: string) {
  if (utf8Bytes(content) > RESOURCE_LIMITS.chatMessageBytes) exceeded("CHAT_RESPONSE_LIMIT", "AI response exceeds 64 KiB. Ask a narrower question or request smaller sections.");
}

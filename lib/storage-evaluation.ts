import { createHash } from "node:crypto";
import { RESOURCE_LIMITS, utf8Bytes, validateProjectResources } from "./resource-limits";
import { templateFolderSchema, type TemplateFolder } from "../features/playground/libs/path-to-json";

const PROJECT_ID = "storage-evaluation-project";
const jsonBytes = (value: unknown) => utf8Bytes(JSON.stringify(value));

/** Offline payload accounting only; this module never connects to a database. */
export function inspectProjectStorage(content: unknown) {
  const { root, bytes } = validateProjectResources(content);
  const tree = templateFolderSchema.parse(root);
  const files = new Map<string, string>();
  const folders: string[] = [];
  const paths = new Set<string>();
  const pending = [{ folder: tree, prefix: "" }];
  while (pending.length) {
    const { folder, prefix } = pending.pop()!;
    folders.push(prefix);
    for (const item of folder.items) {
      const name = "folderName" in item ? item.folderName : item.filename + (item.fileExtension ? `.${item.fileExtension}` : "");
      const path = prefix ? `${prefix}/${name}` : name;
      if (paths.has(path)) throw new Error(`Ambiguous project path: ${path}`);
      paths.add(path);
      if ("folderName" in item) pending.push({ folder: item, prefix: path });
      else files.set(path, item.content);
    }
  }
  folders.sort();
  const records = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, value]) => ({
    playgroundId: PROJECT_ID, path, content: value, version: 1,
  }));
  const blobs = new Map<string, number>();
  const references = records.map(record => {
    const hash = createHash("sha256").update(record.content, "utf8").digest("hex");
    const size = utf8Bytes(record.content);
    blobs.set(hash, size);
    return { path: record.path, sha256: hash, bytes: size };
  });
  const manifest = { playgroundId: PROJECT_ID, rootFolderName: tree.folderName, folders, version: 1 };
  const fileManifestBytes = jsonBytes(manifest);
  const objectManifestBytes = jsonBytes({ ...manifest, files: references });
  return {
    tree, files, records, blobs, fileManifestBytes, objectManifestBytes,
    summary: {
      files: files.size,
      folders: folders.length,
      sourceBytes: bytes,
      treeJsonBytes: jsonBytes(tree),
      persistedContentJsonBytes: jsonBytes(content),
      legacyStringContentJsonBytes: jsonBytes(JSON.stringify(tree)),
      perFileModelBytes: records.reduce((sum, record) => sum + jsonBytes(record), fileManifestBytes),
      objectModelBytes: [...blobs.values()].reduce((sum, size) => sum + size, objectManifestBytes),
      uniqueObjects: blobs.size,
    },
  };
}

/** Bytes removed plus inserted in the smallest contiguous UTF-8 byte replacement. */
function editBytes(previous: string, next: string) {
  const before = Buffer.from(previous, "utf8"), after = Buffer.from(next, "utf8");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return endBefore - start + endAfter - start;
}

export function compareProjectSave(previous: unknown, next: unknown) {
  const before = inspectProjectStorage(previous), after = inspectProjectStorage(next);
  const changedPaths = [...after.files.keys()].filter(path => before.files.get(path) !== after.files.get(path));
  const deletedPaths = [...before.files.keys()].filter(path => !after.files.has(path));
  const contentEditBytes = changedPaths.reduce((sum, path) => sum + editBytes(before.files.get(path) ?? "", after.files.get(path)!), 0)
    + deletedPaths.reduce((sum, path) => sum + utf8Bytes(before.files.get(path)!), 0);
  const changedFileBytes = changedPaths.reduce((sum, path) => sum + utf8Bytes(after.files.get(path)!), 0);
  const newObjectBytes = [...after.blobs].reduce((sum, [hash, size]) => sum + (before.blobs.has(hash) ? 0 : size), 0);
  // Illustrative alternatives retain a project-level version fence/empty-folder manifest.
  // The current action writes content even for an unchanged save; version metadata is excluded.
  const currentBytes = after.summary.persistedContentJsonBytes;
  return {
    changedFiles: changedPaths.length,
    deletedFiles: deletedPaths.length,
    contentEditBytes,
    changedFileBytes,
    currentContentWriteBytes: currentBytes,
    perFileModelWriteBytes: after.records.filter(record => changedPaths.includes(record.path)).reduce((sum, record) => sum + jsonBytes(record), after.fileManifestBytes),
    perFileModelDeleteOperations: deletedPaths.length,
    objectModelWriteBytes: newObjectBytes + after.objectManifestBytes,
    newObjectBytes,
    contentPayloadAmplification: contentEditBytes ? currentBytes / contentEditBytes : null,
  };
}

export function createStorageFixtures(): { name: string; content: TemplateFolder }[] {
  const sized = (name: string, files: number, bytes: number): TemplateFolder => ({
    folderName: name,
    items: Array.from({ length: files }, (_, index) => ({
      filename: `file-${index}`, fileExtension: "ts",
      content: (`// file ${index}\n` + "x".repeat(bytes)).slice(0, bytes),
    })),
  });
  return [
    { name: "empty", content: { folderName: "empty", items: [] } },
    { name: "medium-100-files", content: sized("medium", 100, 4096) },
    // Leave one byte per file for the edit workload while staying under the 2 MiB cap.
    { name: "near-source-limit", content: sized("near-limit", 8, RESOURCE_LIMITS.fileBytes - 1) },
    { name: "file-count-limit", content: sized("many-files", RESOURCE_LIMITS.files, 512) },
    { name: "near-json-limit", content: { folderName: "escaped", items: Array.from({ length: 12 }, (_, index) => ({
      filename: `escaped-${index}`, fileExtension: "txt", content: "\\".repeat(131000),
    })) } },
    { name: "unicode-and-escaping", content: { folderName: "unicode", items: [
      { filename: "quoted", fileExtension: "txt", content: ('😀\"\\\n').repeat(8192) },
      { folderName: "empty-folder", items: [] },
    ] } },
  ];
}

export function evaluateStorageScenario(name: string, content: unknown) {
  const initial = inspectProjectStorage(content);
  const next = structuredClone(initial.tree);
  const batch = structuredClone(initial.tree);
  const rewrite = structuredClone(initial.tree);
  let target: { content: string } | undefined;
  const pending = [next];
  while (pending.length && !target) {
    const folder = pending.pop()!;
    for (const item of folder.items) {
      if ("folderName" in item) pending.push(item);
      else { target = item; break; }
    }
  }
  if (target) target.content += "x";
  let appended = 0;
  const batchPending = [batch];
  while (batchPending.length && appended < 10) {
    for (const item of batchPending.pop()!.items) {
      if ("folderName" in item) batchPending.push(item);
      else if (appended < 10) { item.content += "x"; appended++; }
    }
  }
  let rewritten = false;
  const rewritePending = [rewrite];
  while (rewritePending.length && !rewritten) {
    for (const item of rewritePending.pop()!.items) {
      if ("folderName" in item) rewritePending.push(item);
      else { item.content = "z".repeat(utf8Bytes(item.content)); rewritten = true; break; }
    }
  }
  return {
    name,
    ...initial.summary,
    currentPlusMaxSnapshotsContentJsonBytes: initial.summary.persistedContentJsonBytes * (RESOURCE_LIMITS.snapshots + 1),
    unchangedSave: compareProjectSave(content, initial.tree),
    oneByteAppend: target ? compareProjectSave(content, next) : null,
    batchAppend: target ? compareProjectSave(content, batch) : null,
    oneFileRewrite: target ? compareProjectSave(content, rewrite) : null,
  };
}

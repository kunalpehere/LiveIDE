import type { FileSystemTree } from "@webcontainer/api";

export const isDependencyInput = (path: string) =>
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|\.npmrc)$/.test(path);

export function projectFiles(tree: FileSystemTree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, entry] of Object.entries(tree)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = prefix + name;
    if ("directory" in entry) {
      for (const [key, value] of projectFiles(entry.directory, path + "/")) result.set(key, value);
    } else if ("file" in entry) {
      const content = "contents" in entry.file ? entry.file.contents : `symlink:${entry.file.symlink}`;
      result.set(path, typeof content === "string" ? content : new TextDecoder().decode(content));
    }
  }
  return result;
}

// Exact comparison avoids hash collisions. Local dependencies and lifecycle
// scripts can consume source files: conservatively include all files for those.
export function dependencySignature(files: Map<string, string>): string {
  const manifests = [...files].filter(([path]) => /(^|\/)package\.json$/.test(path));
  const sourceSensitive = manifests.some(([, content]) => {
    try {
      const manifest = JSON.parse(content);
      return ["preinstall", "install", "postinstall", "prepare"].some(key => manifest.scripts?.[key]) ||
        [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(deps =>
          deps && Object.values(deps).some(value => typeof value === "string" && /^(file:|link:|\.\.?\/)/.test(value)));
    } catch { return true; }
  });
  return JSON.stringify([...files].filter(([path]) => sourceSensitive || isDependencyInput(path))
    .sort(([a], [b]) => a.localeCompare(b)));
}

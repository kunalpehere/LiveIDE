import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface TemplateFile {
  filename: string;
  fileExtension: string;
  content: string;
}

export interface TemplateFolder {
  folderName: string;
  items: TemplateItem[];
}

export type TemplateItem = TemplateFile | TemplateFolder;

export interface ScanOptions {
  ignoreFiles?: string[];
  ignoreFolders?: string[];
  ignorePatterns?: RegExp[];
  maxFileSize?: number;
  maxTotalSize?: number;
  maxFiles?: number;
  maxDepth?: number;
}

export const DEFAULT_TEMPLATE_LIMITS = {
  maxFileSize: 256 * 1024,
  maxTotalSize: 2 * 1024 * 1024,
  maxFiles: 250,
  maxDepth: 20,
} as const;

const safeName = z.string().min(1).max(255).refine(
  name => name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\"),
  "Template names must not contain path separators",
);

export const templateFileSchema: z.ZodType<TemplateFile> = z.object({
  filename: safeName,
  fileExtension: z.string().max(32).regex(/^[a-zA-Z0-9_-]*$/),
  content: z.string(),
});

export const templateFolderSchema: z.ZodType<TemplateFolder> = z.lazy(() =>
  z.object({
    folderName: safeName,
    items: z.array(z.union([templateFileSchema, templateFolderSchema])),
  }),
);

const defaultOptions: Required<ScanOptions> = {
  ignoreFiles: [
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store", "thumbs.db",
    ".gitignore", ".npmrc", ".yarnrc", ".env", ".env.local",
    ".env.development", ".env.production",
  ],
  ignoreFolders: [
    "node_modules", ".git", ".vscode", ".idea", ".next", ".angular",
    "dist", "build", "coverage",
  ],
  ignorePatterns: [/^\..+\.swp$/, /^\.#/, /~$/],
  ...DEFAULT_TEMPLATE_LIMITS,
};

interface ScanState {
  files: number;
  totalBytes: number;
}

function mergeOptions(options: ScanOptions): Required<ScanOptions> {
  return {
    ...defaultOptions,
    ...options,
    ignoreFiles: [...defaultOptions.ignoreFiles, ...(options.ignoreFiles ?? [])],
    ignoreFolders: [...defaultOptions.ignoreFolders, ...(options.ignoreFolders ?? [])],
    ignorePatterns: [...defaultOptions.ignorePatterns, ...(options.ignorePatterns ?? [])],
  };
}

async function processDirectory(
  folderName: string,
  folderPath: string,
  options: Required<ScanOptions>,
  state: ScanState,
  depth: number,
): Promise<TemplateFolder> {
  if (depth > options.maxDepth) {
    throw new Error(`Template exceeds maximum folder depth of ${options.maxDepth}`);
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const items: TemplateItem[] = [];

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in templates: ${entry.name}`);
    }

    if (entry.isDirectory()) {
      if (options.ignoreFolders.includes(entry.name)) continue;
      items.push(await processDirectory(entry.name, entryPath, options, state, depth + 1));
      continue;
    }

    if (!entry.isFile()) continue;
    if (options.ignoreFiles.includes(entry.name)) continue;
    if (options.ignorePatterns.some(pattern => pattern.test(entry.name))) continue;

    const stats = await fs.stat(entryPath);
    state.files += 1;
    state.totalBytes += stats.size;

    if (state.files > options.maxFiles) {
      throw new Error(`Template exceeds maximum file count of ${options.maxFiles}`);
    }
    if (stats.size > options.maxFileSize) {
      throw new Error(`Template file ${entry.name} exceeds ${options.maxFileSize} bytes`);
    }
    if (state.totalBytes > options.maxTotalSize) {
      throw new Error(`Template exceeds total size limit of ${options.maxTotalSize} bytes`);
    }

    const parsed = path.parse(entry.name);
    items.push({
      filename: parsed.name,
      fileExtension: parsed.ext.replace(/^\./, ""),
      content: await fs.readFile(entryPath, "utf8"),
    });
  }

  return { folderName, items };
}

/** Read and validate a starter directory without writing intermediate files. */
export async function scanTemplateDirectory(
  templatePath: string,
  options: ScanOptions = {},
): Promise<TemplateFolder> {
  if (!templatePath) throw new Error("Template path is required");

  const stats = await fs.stat(templatePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`Template directory does not exist: ${templatePath}`);
    throw error;
  });
  if (!stats.isDirectory()) throw new Error(`Template path is not a directory: ${templatePath}`);

  const result = await processDirectory(
    path.basename(templatePath),
    templatePath,
    mergeOptions(options),
    { files: 0, totalBytes: 0 },
    0,
  );

  return templateFolderSchema.parse(result);
}

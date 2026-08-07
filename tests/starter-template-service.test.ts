import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  scanTemplateDirectory,
  templateFolderSchema,
} from "@/features/playground/libs/path-to-json";
import {
  clearStarterTemplateCache,
  getStarterTemplate,
} from "@/features/playground/lib/starter-template-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearStarterTemplateCache();
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("in-memory starter templates", () => {
  it("scans and validates a real starter without intermediate JSON files", async () => {
    const template = await getStarterTemplate("REACT");

    expect(template.folderName).toBe("react-ts");
    expect(template.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(template)).toContain("Welcome to React TypeScript Starter");
  });

  it("shares one immutable cached result across concurrent requests", async () => {
    const [first, second, third] = await Promise.all([
      getStarterTemplate("VUE"),
      getStarterTemplate("VUE"),
      getStarterTemplate("VUE"),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
  });

  it("rejects templates that exceed the configured file limit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "liveide-template-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(path.join(directory, "one.ts"), "export const one = 1;"),
      writeFile(path.join(directory, "two.ts"), "export const two = 2;"),
    ]);

    await expect(scanTemplateDirectory(directory, { maxFiles: 1 }))
      .rejects.toThrow("maximum file count");
  });

  it("rejects malformed or path-like names in recursive template data", () => {
    const result = templateFolderSchema.safeParse({
      folderName: "Root",
      items: [{ filename: "../secret", fileExtension: "ts", content: "" }],
    });

    expect(result.success).toBe(false);
  });
});

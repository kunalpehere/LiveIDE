import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectProjectStorage, compareProjectSave, createStorageFixtures, evaluateStorageScenario } from "@/lib/storage-evaluation";
import { scanTemplateDirectory } from "@/features/playground/libs/path-to-json";
import { RESOURCE_LIMITS } from "@/lib/resource-limits";
import { templatePaths } from "@/lib/template";

const tree = (content: string) => ({ folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content }] });

describe("storage model evaluation", () => {
  it("accounts for UTF-8, JSON escaping, and both existing persistence formats without mutating them", () => {
    const input = tree('😀\"\\\n'), frozen = JSON.stringify(input);
    const native = inspectProjectStorage(input), legacy = inspectProjectStorage(frozen);
    expect(native.summary.sourceBytes).toBe(7);
    expect(native.summary.treeJsonBytes).toBe(Buffer.byteLength(frozen));
    expect(legacy.summary.persistedContentJsonBytes).toBe(Buffer.byteLength(JSON.stringify(frozen)));
    expect(legacy.tree).toEqual(input);
    expect(native.tree).toEqual(legacy.tree);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("measures a one-byte append against the entire content replacement", () => {
    const result = compareProjectSave(tree("abc"), tree("abcd"));
    expect(result.contentEditBytes).toBe(1);
    expect(result.changedFileBytes).toBe(4);
    expect(result.changedFiles).toBe(1);
    expect(result.currentContentWriteBytes).toBe(Buffer.byteLength(JSON.stringify(tree("abcd"))));
    expect(result.contentPayloadAmplification).toBe(result.currentContentWriteBytes);
    expect(result.newObjectBytes).toBe(4);
  });

  it("distinguishes no-op content writes from changes without dividing by zero", () => {
    const result = compareProjectSave(tree("abc"), tree("abc"));
    expect(result.changedFiles).toBe(0);
    expect(result.newObjectBytes).toBe(0);
    expect(result.contentPayloadAmplification).toBeNull();
    expect(result.currentContentWriteBytes).toBeGreaterThan(0);
    expect(result.perFileModelWriteBytes).toBeGreaterThan(0);
  });

  it("accounts for deleted and renamed files and reusable content objects", () => {
    const renamed = { folderName: "Root", items: [{ filename: "Other", fileExtension: "tsx", content: "abc" }] };
    const result = compareProjectSave(tree("abc"), renamed);
    expect(result).toMatchObject({ changedFiles: 1, deletedFiles: 1, perFileModelDeleteOperations: 1, newObjectBytes: 0 });
    expect(compareProjectSave(tree("abc"), { folderName: "Root", items: [] })).toMatchObject({ changedFiles: 0, deletedFiles: 1, contentEditBytes: 3 });
  });

  it("preserves empty directories and distinguishes identical files from unique objects", () => {
    const input = { folderName: "Root", items: [...tree("abc").items, { filename: "Other", fileExtension: "tsx", content: "abc" }, { folderName: "empty", items: [] }] };
    const result = inspectProjectStorage(input);
    expect(result.summary).toMatchObject({ files: 2, folders: 2, sourceBytes: 6, uniqueObjects: 1 });
    expect(result.files.get("App.tsx")).toBe("abc");
    expect(result.tree).toEqual(input);
  });

  it("rejects invalid or ambiguous trees rather than silently losing file records", () => {
    expect(() => inspectProjectStorage("bad JSON")).toThrow();
    expect(() => inspectProjectStorage({ folderName: "Root", items: [...tree("abc").items, ...tree("def").items] })).toThrow(/Ambiguous/);
  });

  it("generates a repeatable content-free report for all starters and bounded workloads", async () => {
    const starters = await Promise.all(Object.entries(templatePaths).map(async ([name, folder]) => ({
      name: `starter-${name.toLowerCase()}`,
      content: await scanTemplateDirectory(path.join(process.cwd(), "starter-templates", folder)),
    })));
    const scenarios = [...starters, ...createStorageFixtures()].map(({ name, content }) => evaluateStorageScenario(name, content));
    for (const scenario of scenarios) {
      expect(scenario.files).toBeLessThanOrEqual(RESOURCE_LIMITS.files);
      expect(scenario.sourceBytes).toBeLessThanOrEqual(RESOURCE_LIMITS.projectBytes);
      expect(scenario.treeJsonBytes).toBeLessThanOrEqual(RESOURCE_LIMITS.projectJsonBytes);
      expect(scenario.unchangedSave.changedFiles).toBe(0);
      if (scenario.files) {
        expect(scenario.oneByteAppend?.contentEditBytes).toBe(1);
        expect(scenario.batchAppend?.contentEditBytes).toBe(Math.min(10, scenario.files));
        expect(scenario.oneFileRewrite?.changedFiles).toBe(1);
      }
    }
    const repeated = [...starters, ...createStorageFixtures()].map(({ name, content }) => evaluateStorageScenario(name, content));
    expect(repeated).toEqual(scenarios);
    const report = {
      formatVersion: 1,
      method: "Compact UTF-8 JSON content payloads; per-file and content-addressed object alternatives are offline models, not database write/disk/network measurements.",
      limits: { sourceBytes: RESOURCE_LIMITS.projectBytes, jsonBytes: RESOURCE_LIMITS.projectJsonBytes, files: RESOURCE_LIMITS.files, snapshots: RESOURCE_LIMITS.snapshots },
      decision: "retain-whole-tree-json-for-bounded-beta",
      scenarios,
    };
    const serialized = JSON.stringify(report, null, 2) + "\n";
    expect(serialized).not.toContain("storage-evaluation-project");
    expect(serialized).not.toContain("export ");
    await mkdir("reports", { recursive: true });
    await writeFile("reports/storage-evaluation.json", serialized);
    console.table(scenarios.map(scenario => ({ scenario: scenario.name, files: scenario.files, sourceBytes: scenario.sourceBytes, treeJsonBytes: scenario.treeJsonBytes,
      appendWriteBytes: scenario.oneByteAppend?.currentContentWriteBytes ?? 0,
      perFileModelWriteBytes: scenario.oneByteAppend?.perFileModelWriteBytes ?? 0,
      objectModelWriteBytes: scenario.oneByteAppend?.objectModelWriteBytes ?? 0,
    })));
  }, 30_000);
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { savedFiles } from "@/lib/github/commit-policy";
import { assertChatMessage, readLimitedBody, RESOURCE_LIMITS as limits, validateProjectResources } from "@/lib/resource-limits";
import { parseTemplateData } from "@/features/playground/lib/validation";

const file = (content = "", filename = "a") => ({ filename, fileExtension: "txt", content });
const tree = (items: unknown[]) => ({ folderName: "Root", items });

describe("resource policy", () => {
  it("applies the same publish policy to JSON objects and serialized saved trees", () => {
    const root = tree([file("source")]);
    expect(savedFiles(root)).toEqual(savedFiles(JSON.stringify(root)));
    expect(() => savedFiles(tree([file("x".repeat(limits.fileBytes + 1))]))).toThrow(/Reduce/);
  });
  it("accepts 250 files and rejects 251", () => {
    expect(validateProjectResources(tree(Array.from({ length: limits.files }, (_, i) => file("", String(i))))).files).toBe(250);
    expect(() => validateProjectResources(tree(Array.from({ length: limits.files + 1 }, () => file())))).toThrow(/250 files/);
  });
  it("rejects ambiguous file/folder entries that could bypass content accounting", () => {
    const mixed = { ...file("x".repeat(limits.fileBytes + 1)), folderName: "disguised", items: [] };
    expect(() => parseTemplateData(tree([mixed]))).toThrow(/conflicting fields/);
  });
  it("counts UTF-8 bytes rather than characters at the file boundary", () => {
    expect(() => parseTemplateData(tree([file("é".repeat(limits.fileBytes / 2))]))).not.toThrow();
    expect(() => parseTemplateData(tree([file("é".repeat(limits.fileBytes / 2) + "x")]))).toThrow(/256 KiB/);
  });
  it("accepts exactly 2 MiB of source and rejects another byte", () => {
    const items = Array.from({ length: 8 }, (_, i) => file("x".repeat(limits.fileBytes), String(i)));
    expect(validateProjectResources(tree(items)).bytes).toBe(limits.projectBytes);
    expect(() => validateProjectResources(tree([...items, file("x")]))).toThrow(/2 MiB/);
  });
  it("bounds folder depth before recursive parsing", () => {
    let root = tree([]);
    for (let i = 0; i < 20; i++) root = tree([root]);
    expect(() => parseTemplateData(root)).not.toThrow();
    expect(() => parseTemplateData(tree([root]))).toThrow(/20 folder levels/);
  });
  it("bounds empty folders and rejects invalid or cyclic input", () => {
    expect(() => validateProjectResources(tree(Array.from({ length: 499 }, () => tree([]))))).not.toThrow();
    expect(() => validateProjectResources(tree(Array.from({ length: 500 }, () => tree([]))))).toThrow(/500 folders/);
    const root = tree([]); root.items.push(root);
    expect(() => validateProjectResources(root)).toThrow(/cycles/);
    expect(() => parseTemplateData({ arbitrary: "data" })).toThrow(/folders and text files/);
  });
  it("validates serialized imported trees and bounds JSON overhead", () => {
    expect(() => parseTemplateData(JSON.stringify(tree([file("hello")])))).not.toThrow();
    const items = Array.from({ length: 8 }, () => file("\0".repeat(limits.fileBytes)));
    expect(() => validateProjectResources(tree(items))).toThrow(/3 MiB/);
  });
  it("accepts exactly 3 MiB serialized JSON and rejects one additional byte", () => {
    const items = Array.from({ length: 8 }, (_, i) => file('"'.repeat(190 * 1024), String(i)));
    const padding = file("", "padding");
    const root = tree([...items, padding]);
    padding.content = "x".repeat(limits.projectJsonBytes - new TextEncoder().encode(JSON.stringify(root)).byteLength);
    expect(() => validateProjectResources(root)).not.toThrow();
    padding.content += "x";
    expect(() => validateProjectResources(root)).toThrow(/3 MiB/);
  });
  it("accepts a 64 KiB response and rejects a larger one", () => {
    expect(() => assertChatMessage("x".repeat(limits.chatMessageBytes))).not.toThrow();
    expect(() => assertChatMessage("x".repeat(limits.chatMessageBytes + 1))).toThrow(/narrower question/);
  });
  it("accepts an exact request limit without Content-Length", async () => {
    expect(await readLimitedBody(new Request("http://local", { method: "POST", body: "éé" }), 4)).toBe("éé");
  });
  it("rejects actual overflow even when Content-Length understates it", async () => {
    await expect(readLimitedBody(new Request("http://local", { method: "POST", body: "ééx", headers: { "content-length": "1" } }), 4)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", status: 413 });
  });
});

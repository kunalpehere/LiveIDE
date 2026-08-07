import { describe, expect, it } from "vitest";

import { findFilePath, generateFileId } from "@/features/playground/libs";
import type { TemplateFolder } from "@/features/playground/libs/path-to-json";

const appFile = { filename: "App", fileExtension: "tsx", content: "export default App" };
const tree: TemplateFolder = {
  folderName: "Root",
  items: [{ folderName: "src", items: [appFile] }],
};

describe("file tree identity", () => {
  it("finds a nested file path", () => {
    expect(findFilePath(appFile, tree)).toBe("src/App.tsx");
  });

  it("uses the path exactly once in stable editor IDs", () => {
    expect(generateFileId(appFile, tree)).toBe("src/App.tsx");
  });

  it("falls back to a filename when the file is outside the tree", () => {
    expect(generateFileId({ filename: "new", fileExtension: "ts", content: "" }, tree)).toBe("new.ts");
  });
});

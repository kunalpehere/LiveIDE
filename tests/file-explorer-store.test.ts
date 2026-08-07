import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";

const file = { filename: "App", fileExtension: "tsx", content: "original" };
const template = { folderName: "Root", items: [{ folderName: "src", items: [file] }] };

beforeEach(() => {
  useFileExplorer.setState({
    playgroundId: "project-one", templateData: template, openFiles: [],
    activeFileId: null, editorContent: "",
  });
});

describe("file explorer editor state", () => {
  it("opens nested files with a stable path and avoids duplicate tabs", () => {
    useFileExplorer.getState().openFile(file);
    useFileExplorer.getState().openFile(file);
    const state = useFileExplorer.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFileId).toBe("src/App.tsx");
    expect(state.editorContent).toBe("original");
  });

  it("tracks unsaved content and clears the editor after closing", () => {
    useFileExplorer.getState().openFile(file);
    useFileExplorer.getState().updateFileContent("src/App.tsx", "changed");
    expect(useFileExplorer.getState().openFiles[0]?.hasUnsavedChanges).toBe(true);
    useFileExplorer.getState().closeFile("src/App.tsx");
    expect(useFileExplorer.getState()).toMatchObject({ openFiles: [], activeFileId: null, editorContent: "" });
  });

  it("restores the original saved-state marker when content is reverted", () => {
    useFileExplorer.getState().openFile(file);
    useFileExplorer.getState().updateFileContent("src/App.tsx", "changed");
    useFileExplorer.getState().updateFileContent("src/App.tsx", "original");
    expect(useFileExplorer.getState().openFiles[0]?.hasUnsavedChanges).toBe(false);
  });
});

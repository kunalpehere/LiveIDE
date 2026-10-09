// @vitest-environment jsdom
import React, { Profiler } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { useWorkspaceFiles } from "@/features/playground/hooks/useWorkspaceFiles";

vi.mock("@/features/playground/components/playground-editor", () => ({
  PlaygroundEditor: ({ content, onContentChange }: { content: string; onContentChange: (value: string) => void }) =>
    <textarea aria-label="Draft" value={content} onChange={event => onContentChange(event.target.value)} />,
}));
import { WorkspaceEditor } from "@/features/playground/components/workspace-editor";

const editorProps = {
  playgroundId: "profile-project", filePath: "main.js", suggestion: null,
  suggestionLoading: false, suggestionPosition: null,
  onAcceptSuggestion: vi.fn(), onRejectSuggestion: vi.fn(), onTriggerSuggestion: vi.fn(),
};

beforeEach(() => {
  useFileExplorer.setState({
    playgroundId: "profile-project", activeFileId: "main.js", editorContent: "",
    openFiles: [{ id: "main.js", filename: "main", fileExtension: "js", content: "",
      originalContent: "", hasUnsavedChanges: false }],
  });
});
afterEach(cleanup);

it("profiles the previous broad subscription against the workspace metadata boundary", () => {
  const broadCommits = vi.fn();
  const shellCommits = vi.fn();
  function BroadShell() {
    const state = useFileExplorer();
    return <Profiler id="baseline" onRender={broadCommits}><span>{state.openFiles.length}</span></Profiler>;
  }
  function NarrowShell() {
    const files = useWorkspaceFiles();
    return <Profiler id="shell" onRender={shellCommits}><span>{files.length}:{String(files[0]?.hasUnsavedChanges)}</span></Profiler>;
  }
  render(<><BroadShell /><NarrowShell /><WorkspaceEditor {...editorProps} /></>);
  broadCommits.mockClear();
  shellCommits.mockClear();
  // Separate React commits, as with successive user keystrokes.
  for (let index = 1; index <= 30; index++) {
    act(() => useFileExplorer.getState().updateFileContent("main.js", "x".repeat(index)));
  }
  expect(broadCommits).toHaveBeenCalledTimes(30);
  expect(shellCommits).toHaveBeenCalledTimes(1); // clean -> dirty only
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("x".repeat(30));
  act(() => useFileExplorer.getState().updateFileContent("main.js", ""));
  expect(shellCommits).toHaveBeenCalledTimes(2); // undo -> clean
});

it("updates metadata for tab changes and retains drafts outside shell props", () => {
  function Tabs() {
    const files = useWorkspaceFiles();
    return <div data-testid="tabs">{files.map(file => file.filename).join(",")}</div>;
  }
  render(<><Tabs /><WorkspaceEditor {...editorProps} /></>);
  act(() => useFileExplorer.setState(state => ({ openFiles: [...state.openFiles, {
    id: "other.js", filename: "other", fileExtension: "js", content: "second draft",
    originalContent: "second", hasUnsavedChanges: true,
  }], activeFileId: "other.js" })));
  expect(screen.getByTestId("tabs")).toHaveTextContent("main,other");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("second draft");
  act(() => useFileExplorer.getState().closeFile("other.js"));
  expect(screen.getByTestId("tabs")).toHaveTextContent("main");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

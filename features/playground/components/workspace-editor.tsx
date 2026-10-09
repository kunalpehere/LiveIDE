"use client";

import { memo, useCallback, type ComponentProps } from "react";
import { useFileExplorer } from "../hooks/useFileExplorer";
import { PlaygroundEditor } from "./playground-editor";

type WorkspaceEditorProps = Omit<ComponentProps<typeof PlaygroundEditor>,
  "activeFile" | "content" | "onContentChange">;

// The only workspace boundary subscribed to the active draft's content.
export const WorkspaceEditor = memo(function WorkspaceEditor(props: WorkspaceEditorProps) {
  const activeFile = useFileExplorer(state => state.openFiles.find(file => file.id === state.activeFileId));
  const onContentChange = useCallback((value: string) => {
    const state = useFileExplorer.getState();
    if (state.activeFileId) state.updateFileContent(state.activeFileId, value);
  }, []);
  return <PlaygroundEditor {...props} activeFile={activeFile} content={activeFile?.content || ""} onContentChange={onContentChange} />;
});

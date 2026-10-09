import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFileExplorer } from "./useFileExplorer";

// Content changes belong to the editor. The shell only needs tab identity and
// dirty state; a shallow primitive snapshot stays equal while typing a draft.
export function useWorkspaceFiles() {
  const metadata = useFileExplorer(useShallow(state => state.openFiles.flatMap(file => [
    file.id, file.filename, file.fileExtension, file.hasUnsavedChanges,
  ])));
  return useMemo(() => {
    const files = [];
    for (let index = 0; index < metadata.length; index += 4) {
      files.push({
        id: metadata[index] as string,
        filename: metadata[index + 1] as string,
        fileExtension: metadata[index + 2] as string,
        hasUnsavedChanges: metadata[index + 3] as boolean,
      });
    }
    return files;
  }, [metadata]);
}

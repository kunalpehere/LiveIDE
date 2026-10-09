import type { z } from "zod";
import type { editor } from "monaco-editor";
import { followViewSchema, participantSchema } from "@/lib/collaboration-follow.mjs";
export { followViewSchema, participantSchema };
import type { TemplateFile, TemplateFolder } from "../types";

export type FollowView = z.infer<typeof followViewSchema>;
export type FollowParticipant = z.infer<typeof participantSchema> & { clientId: number };

export function fileAtPath(root: TemplateFolder, path: string): TemplateFile | null {
  const parts = path.split("/");
  let folder = root;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) return folder.items.find((item): item is TemplateFile =>
      "filename" in item && `${item.filename}${item.fileExtension ? `.${item.fileExtension}` : ""}` === part) ?? null;
    const next = folder.items.find((item): item is TemplateFolder => "folderName" in item && item.folderName === part);
    if (!next) return null;
    folder = next;
  }
  return null;
}

/** Only move the view. Never use setValue, executeEdits or a document transaction. */
export function applyFollowView(target: editor.IStandaloneCodeEditor, view: FollowView) {
  const model = target.getModel();
  if (!model || model.isDisposed()) return;
  const anchor = model.validatePosition({ lineNumber: view.selection.selectionStartLineNumber, column: view.selection.selectionStartColumn });
  const cursor = model.validatePosition({ lineNumber: view.selection.positionLineNumber, column: view.selection.positionColumn });
  target.setSelection({ selectionStartLineNumber: anchor.lineNumber, selectionStartColumn: anchor.column,
    positionLineNumber: cursor.lineNumber, positionColumn: cursor.column }, "liveide-follow");
  target.setScrollPosition({ scrollTop: view.scrollTop, scrollLeft: view.scrollLeft });
}

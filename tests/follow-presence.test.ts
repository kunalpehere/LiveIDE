import { expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import * as encoding from "lib0/encoding";
import { applyFollowView, fileAtPath, followViewSchema } from "@/features/playground/lib/follow-presence";
import { createFollowPresenceValidator } from "@/lib/collaboration-follow.mjs";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { findFilePath, generateFileId } from "@/features/playground/libs";

const view = { filePath: "src/main.ts", selection: { selectionStartLineNumber: 8, selectionStartColumn: 3, positionLineNumber: 2, positionColumn: 1 }, scrollTop: 120, scrollLeft: 20 };
it("clamps remote selections and moves only the view, preserving backwards selections", () => {
  const target = { getModel: () => ({ isDisposed: () => false, validatePosition: ({ lineNumber, column }: { lineNumber: number; column: number }) => ({ lineNumber: Math.min(lineNumber, 4), column }) }),
    setSelection: vi.fn(), setScrollPosition: vi.fn(), setValue: vi.fn(), executeEdits: vi.fn() };
  applyFollowView(target as unknown as editor.IStandaloneCodeEditor, view);
  expect(target.setSelection).toHaveBeenCalledWith({ ...view.selection, selectionStartLineNumber: 4 }, "liveide-follow");
  expect(target.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 120, scrollLeft: 20 });
  expect(target.setValue).not.toHaveBeenCalled(); expect(target.executeEdits).not.toHaveBeenCalled();
});
it("rejects malformed view state and resolves exact paths with duplicate filenames", () => {
  expect(followViewSchema.safeParse({ ...view, scrollTop: Infinity }).success).toBe(false);
  expect(followViewSchema.safeParse({ ...view, filePath: "../secret" }).success).toBe(false);
  const root = { folderName: "Root", items: [{ filename: "main", fileExtension: "ts", content: "root" },
    { folderName: "src", items: [{ filename: "main", fileExtension: "ts", content: "nested" }] }] };
  expect(fileAtPath(root, view.filePath)?.content).toBe("nested");
  expect(fileAtPath(root, "missing/main.ts")).toBeNull();
  const nested = fileAtPath(root, view.filePath)!;
  expect(generateFileId(nested, root)).toBe("src/main.ts");
  expect(findFilePath({ ...nested, id: "src/main.ts" }, root)).toBe("src/main.ts");
});
it("opens followed files without replacing drafts and distinguishes intentional navigation", () => {
  const file = { filename: "main", fileExtension: "ts", content: "saved" };
  useFileExplorer.setState({ templateData: { folderName: "Root", items: [file] }, openFiles: [], activeFileId: null, navigationVersion: 0 });
  useFileExplorer.getState().openFile(file);
  const id = useFileExplorer.getState().activeFileId!;
  useFileExplorer.getState().updateFileContent(id, "draft");
  useFileExplorer.getState().openFile(file, "follow");
  expect(useFileExplorer.getState().navigationVersion).toBe(1);
  expect(useFileExplorer.getState().openFiles[0].content).toBe("draft");
  useFileExplorer.getState().openFile(file);
  expect(useFileExplorer.getState().navigationVersion).toBe(2);
});
function presence(id: number, state: unknown) {
  const payload = encoding.createEncoder(); encoding.writeVarUint(payload, 1); encoding.writeVarUint(payload, id);
  encoding.writeVarUint(payload, 1); encoding.writeVarString(payload, JSON.stringify(state));
  const frame = encoding.createEncoder(); encoding.writeVarUint(frame, 1); encoding.writeVarUint8Array(frame, encoding.toUint8Array(payload));
  return encoding.toUint8Array(frame);
}
it("binds project presence to the token identity and one unclaimed awareness ID", () => {
  const user = { id: "user", name: "Peer", color: "#112233" };
  const validate = createFollowPresenceValidator({ userId: user.id, name: user.name, color: user.color }, id => id === 99);
  const state = { user, view, following: null };
  expect(() => validate(presence(1, state))).not.toThrow();
  expect(() => validate(presence(1, { ...state, user: { ...user, name: "Spoof" } }))).toThrow();
  expect(() => validate(presence(2, state))).toThrow();
  expect(() => validate(presence(99, state))).toThrow();
  expect(() => validate(presence(1, null))).not.toThrow();
});

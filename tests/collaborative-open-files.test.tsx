// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { editor } from "monaco-editor";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";

const records = vi.hoisted(() => ({ sessions: [] as Array<{ awareness: Awareness; dispose: ReturnType<typeof vi.fn>; options: { onSynced: () => void; onState: (state: string, message: string | null) => void } }>, bindings: [] as Array<{ destroy: ReturnType<typeof vi.fn> }> }));
vi.mock("y-monaco", () => ({ MonacoBinding: class {
  destroy = vi.fn(); constructor() { records.bindings.push(this); }
} }));
vi.mock("@/lib/collaboration-session", () => ({ CollaborationSession: class {
  awareness: Awareness;
  applicationTiming = { snapshot: () => ({ count: 0 }) };
  dispose = vi.fn(() => this.awareness.destroy());
  constructor(public options: { document: Y.Doc; onSynced: () => void; onState: (state: string, message: string | null) => void }) {
    this.awareness = new Awareness(options.document); records.sessions.push(this);
  }
  start() { this.awareness.setLocalState({ user: { id: "local" } }); this.options.onState("connected", null); this.options.onSynced(); }
  retry() {}
} }));
import { useCollaborativeEditor } from "@/features/playground/hooks/useCollaborativeEditor";
afterEach(() => { cleanup(); records.sessions.splice(0); records.bindings.splice(0); });

it("retains open-file transports and bindings during switching, hides inactive presence, and disposes closed files", () => {
  const first = { filename: "first", fileExtension: "ts", content: "first" };
  const second = { filename: "second", fileExtension: "ts", content: "second" };
  useFileExplorer.setState({ playgroundId: "project", templateData: { folderName: "Root", items: [first, second] }, openFiles: [] });
  useFileExplorer.getState().openFile(first);
  const model = { isDisposed: () => false, getValue: () => "first", onDidChangeContent: () => ({ dispose: vi.fn() }) };
  const target = { getModel: () => model, deltaDecorations: vi.fn(), onDidChangeCursorSelection: () => ({ dispose: vi.fn() }) } as unknown as editor.IStandaloneCodeEditor;
  const hook = renderHook(({ filePath }) => useCollaborativeEditor({ enabled: true, playgroundId: "project", filePath, editorInstance: target }), { initialProps: { filePath: "first.ts" } });
  act(() => useFileExplorer.getState().openFile(second));
  hook.rerender({ filePath: "second.ts" });
  expect(records.sessions).toHaveLength(2);
  expect(records.sessions[0].dispose).not.toHaveBeenCalled();
  expect(records.bindings[0].destroy).not.toHaveBeenCalled();
  expect(records.sessions[0].awareness.getLocalState()).toBeNull();
  act(() => records.sessions[0].options.onState("connected", null));
  expect(records.sessions[0].awareness.getLocalState()).toBeNull();
  hook.rerender({ filePath: "first.ts" });
  expect(records.sessions).toHaveLength(2);
  expect(records.bindings).toHaveLength(2);
  expect(records.sessions[0].awareness.getLocalState()?.user.id).toBe("local");
  act(() => useFileExplorer.getState().closeFile("second.ts"));
  expect(records.sessions[1].dispose).toHaveBeenCalledOnce();
  expect(records.bindings[1].destroy).toHaveBeenCalledOnce();
  hook.unmount();
  expect(records.sessions[0].dispose).toHaveBeenCalledOnce();
});

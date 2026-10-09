// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { editor } from "monaco-editor";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";

const sessions = vi.hoisted(() => [] as Array<{ awareness: Awareness; options: { onState: (status: string) => void }; dispose: ReturnType<typeof vi.fn> }>);
vi.mock("@/lib/collaboration-session", () => ({ CollaborationSession: class {
  awareness: Awareness;
  dispose = vi.fn(() => this.awareness.destroy());
  constructor(public options: { document: Y.Doc; onState: (status: string) => void }) {
    this.awareness = new Awareness(options.document); sessions.push(this);
  }
  start() { this.options.onState("connected"); }
  retry() {}
} }));
import { useFollowCollaborator } from "@/features/playground/hooks/useFollowCollaborator";

const disposeRemote: (() => void)[] = [];
afterEach(() => { cleanup(); disposeRemote.splice(0).forEach(dispose => dispose()); sessions.splice(0); });
function fixture() {
  const first = { filename: "first", fileExtension: "ts", content: "first" };
  const second = { filename: "second", fileExtension: "ts", content: "second" };
  useFileExplorer.setState({ playgroundId: "project", navigationVersion: 0, templateData: { folderName: "Root", items: [first, second] }, openFiles: [], activeFileId: null });
  useFileExplorer.getState().openFile(first);
  const events = new Map<string, (event?: unknown) => void>();
  const register = (name: string) => (callback: (event?: unknown) => void) => { events.set(name, callback); return { dispose: vi.fn(() => events.delete(name)) }; };
  const target = { getModel: () => ({ isDisposed: () => false, validatePosition: (value: unknown) => value }),
    getSelection: () => ({ selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 }),
    getScrollTop: () => 0, getScrollLeft: () => 0, getDomNode: () => null,
    setSelection: vi.fn(), setScrollPosition: vi.fn(),
    onDidChangeCursorSelection: register("selection"), onDidScrollChange: register("scroll"), onKeyDown: register("key"), onMouseDown: register("mouse"), onDidChangeModel: register("model") } as unknown as editor.IStandaloneCodeEditor;
  const hook = renderHook(({ filePath }) => useFollowCollaborator({ enabled: true, playgroundId: "project", filePath, editorInstance: target }), { initialProps: { filePath: "first.ts" } });
  const remoteDoc = new Y.Doc(); const remote = new Awareness(remoteDoc);
  disposeRemote.push(() => { remote.destroy(); remoteDoc.destroy(); });
  remote.setLocalState({ user: { id: "remote", name: "Peer", color: "#112233" }, following: null,
    view: { filePath: "second.ts", selection: { selectionStartLineNumber: 2, selectionStartColumn: 1, positionLineNumber: 3, positionColumn: 2 }, scrollTop: 120, scrollLeft: 0 } });
  const publish = () => act(() => applyAwarenessUpdate(sessions[0].awareness, encodeAwarenessUpdate(remote, [remoteDoc.clientID]), "remote"));
  publish();
  return { ...hook, first, remote, remoteDoc, target, events, publish };
}
it("follows a file and view, preserves drafts, ignores its own navigation and stops on explicit local navigation", () => {
  const hook = fixture();
  const draftId = useFileExplorer.getState().activeFileId!;
  act(() => useFileExplorer.getState().updateFileContent(draftId, "draft"));
  act(() => hook.result.current.follow(hook.remoteDoc.clientID));
  expect(hook.result.current.following).toBe(hook.remoteDoc.clientID);
  expect(useFileExplorer.getState().openFiles.find(file => file.id === draftId)?.content).toBe("draft");
  hook.rerender({ filePath: "second.ts" });
  expect(hook.target.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 120, scrollLeft: 0 });
  act(() => useFileExplorer.getState().openFile(hook.first));
  expect(hook.result.current.following).toBeNull();
});
it.each(["key", "mouse"])("stops on intentional editor %s interaction", event => {
  const hook = fixture();
  act(() => hook.result.current.follow(hook.remoteDoc.clientID));
  act(() => hook.events.get(event)!());
  expect(hook.result.current.following).toBeNull();
});
it("stops when the peer leaves or access/transport fails, and disposes the project session", () => {
  const hook = fixture();
  act(() => hook.result.current.follow(hook.remoteDoc.clientID));
  hook.remote.setLocalState(null); hook.publish();
  expect(hook.result.current.following).toBeNull();
  expect(hook.result.current.message).toContain("participant left");
  act(() => sessions[0].options.onState("failed"));
  expect(hook.result.current.participants).toEqual([]);
  const session = sessions[0]; hook.unmount();
  expect(session.dispose).toHaveBeenCalledOnce();
});
it("prevents follow chains and stops when a followed peer starts following", () => {
  const hook = fixture();
  act(() => hook.result.current.follow(hook.remoteDoc.clientID));
  hook.remote.setLocalStateField("following", 42); hook.publish();
  expect(hook.result.current.following).toBeNull();
  act(() => hook.result.current.follow(hook.remoteDoc.clientID));
  expect(hook.result.current.following).toBeNull();
});

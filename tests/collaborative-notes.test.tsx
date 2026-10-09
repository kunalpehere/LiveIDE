// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { editor } from "monaco-editor";

const records = vi.hoisted(() => ({ sessions: [] as any[], bindings: [] as any[] }));
vi.mock("y-monaco", () => ({ MonacoBinding: class {
  destroy = vi.fn(); constructor() { records.bindings.push(this); }
} }));
vi.mock("@/lib/collaboration-session", () => ({ CollaborationSession: class {
  awareness: Awareness; dispose = vi.fn(() => this.awareness.destroy()); retry = vi.fn();
  constructor(public options: any) { this.awareness = new Awareness(options.document); records.sessions.push(this); }
  start() { this.options.onState("connecting", null); }
} }));
import { useCollaborativeNotes } from "@/features/playground/hooks/useCollaborativeNotes";
import { collaborationRoom, PROJECT_NOTES_PATH } from "@/lib/collaboration-protocol.mjs";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); records.sessions.splice(0); records.bindings.splice(0); });
function setup(canEdit = true) {
  const changed = vi.fn(); let listener = () => {};
  const model = { isDisposed: () => false, onDidChangeContent: (callback: () => void) => { listener = callback; return { dispose: changed }; } };
  const instance = { getModel: () => model, deltaDecorations: vi.fn(), onDidChangeCursorSelection: () => ({ dispose: vi.fn() }) } as unknown as editor.IStandaloneCodeEditor;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data: { protocolVersion: 1, playgroundId: "project", filePath: PROJECT_NOTES_PATH, room: collaborationRoom("project", PROJECT_NOTES_PATH), revision: 1, role: canEdit ? "EDITOR" : "VIEWER", websocketUrl: "ws://localhost:1234", token: "fixture-token", user: { id: "user", name: "User", color: "#112233" } } })));
  const hook = renderHook(({ allowed }) => useCollaborativeNotes({ enabled: true, playgroundId: "project", canEdit: allowed, editorInstance: instance }), { initialProps: { allowed: canEdit } });
  return { hook, changed, change: () => listener() };
}
async function sync() {
  const session = records.sessions[0];
  await act(async () => { await session.options.getToken(new AbortController().signal); session.options.document.getText("content").insert(0, "# Notes"); session.options.onState("connected", null); session.options.onSynced(); });
}
it("locks editing until hydration and keeps a separate live document across role/render changes", async () => {
  const { hook } = setup(); expect(hook.result.current.editable).toBe(false); await sync();
  expect(hook.result.current.text).toBe("# Notes"); expect(hook.result.current.editable).toBe(true);
  hook.rerender({ allowed: false }); expect(hook.result.current.editable).toBe(false); expect(records.sessions).toHaveLength(1);
  act(() => records.sessions[0].options.document.getText("content").insert(0, "Remote "));
  expect(hook.result.current.text).toBe("Remote # Notes"); expect(records.bindings).toHaveLength(1);
});
it("allows synced offline drafts, warns before leaving, and locks on revoked access", async () => {
  const { hook, change } = setup(); await sync();
  act(() => { records.sessions[0].options.onState("offline", "offline"); change(); });
  expect(hook.result.current.editable).toBe(true);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  act(() => records.sessions[0].options.onState("failed", "access changed"));
  expect(hook.result.current.editable).toBe(false); expect(hook.result.current.message).toBe("access changed");
  act(() => hook.result.current.retry()); expect(records.sessions[0].retry).toHaveBeenCalledOnce();
});
it("enforces viewer read-only even when a stale client claims it can edit", async () => {
  const { hook } = setup(false); hook.rerender({ allowed: true }); await sync(); expect(hook.result.current.editable).toBe(false);
});
it("releases bindings, awareness, listeners and document on workspace exit", async () => {
  const { hook, changed } = setup(); await sync(); const destroyed = vi.spyOn(records.sessions[0].options.document, "destroy");
  hook.unmount(); expect(records.sessions[0].dispose).toHaveBeenCalledOnce(); expect(records.bindings[0].destroy).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(destroyed).toHaveBeenCalledOnce();
});

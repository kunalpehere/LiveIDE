import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { CollaborationSession, type CollaborationStatus } from "@/lib/collaboration-session";
import { CollaborationProtocolError, errorResponseSchema, parseTokenResponse, PROJECT_NOTES_PATH, PROTOCOL_VERSION } from "@/lib/collaboration-protocol.mjs";
import { createPresenceEditor } from "../lib/presence-editor";

/** Project notes own their model and Y.Doc; source drafts and runtime are never touched. */
export function useCollaborativeNotes({ playgroundId, enabled, canEdit, editorInstance }: {
  playgroundId: string; enabled: boolean; canEdit: boolean; editorInstance: editor.IStandaloneCodeEditor | null;
}) {
  const [status, setStatus] = useState<CollaborationStatus | "disabled">("disabled");
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [synced, setSynced] = useState(false);
  const [authorizedToEdit, setAuthorizedToEdit] = useState(false);
  const current = useRef<CollaborationSession | null>(null);
  const retry = useCallback(() => current.current?.retry(), []);

  useEffect(() => {
    setSynced(false); setAuthorizedToEdit(false); setText(""); setMessage(null);
    if (!enabled || !editorInstance) { setStatus("disabled"); return; }
    const model = editorInstance.getModel();
    if (!model) return;
    let disposed = false;
    let binding: MonacoBinding | undefined;
    let state: CollaborationStatus = "connecting";
    let unsent = false;
    const document = new Y.Doc();
    const sharedText = document.getText("content");
    const presenceEditor = createPresenceEditor(editorInstance);
    const updateText = () => { if (!disposed) setText(sharedText.toString()); };
    sharedText.observe(updateText);
    const changed = model.onDidChangeContent(() => { if (binding && state !== "connected") unsent = true; });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unsent) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const session = new CollaborationSession({
      document, WebSocket, isOnline: () => navigator.onLine, networkEvents: window,
      onState: (next, detail) => {
        if (disposed) return;
        state = next; setStatus(next); setMessage(detail);
        if (next === "failed") setAuthorizedToEdit(false);
      },
      getToken: async signal => {
        const response = await fetch("/api/collaboration/token", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, playgroundId, filePath: PROJECT_NOTES_PATH }), signal });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const failure = errorResponseSchema.safeParse(body);
          throw new CollaborationProtocolError(failure.success ? failure.data.error.code : response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : "UNAVAILABLE");
        }
        const result = parseTokenResponse(body);
        if (result.data.playgroundId !== playgroundId || result.data.filePath !== PROJECT_NOTES_PATH || result.data.revision !== 1) throw new CollaborationProtocolError("ROOM_MISMATCH");
        if (!disposed) setAuthorizedToEdit(result.data.role !== "VIEWER");
        return result.data;
      },
      onSynced: () => {
        if (disposed || model.isDisposed()) return;
        if (!binding) binding = new MonacoBinding(sharedText, model, new Set([presenceEditor.editor]), session.awareness);
        unsent = false; updateText(); setSynced(true);
      },
    });
    current.current = session;
    session.start();
    return () => {
      disposed = true; current.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
      changed.dispose(); binding?.destroy(); presenceEditor.dispose();
      sharedText.unobserve(updateText); session.dispose(); document.destroy();
    };
  }, [enabled, playgroundId, editorInstance]);

  return { status, message, text, retry, editable: canEdit && authorizedToEdit && synced && status !== "failed" && status !== "disabled" };
}

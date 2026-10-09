import { useEffect, useRef, useCallback, useState } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { PROTOCOL_VERSION, parseTokenResponse, errorResponseSchema, CollaborationProtocolError } from "@/lib/collaboration-protocol.mjs";
import { CollaborationSession, type CollaborationStatus } from "@/lib/collaboration-session";
import { createPresenceEditor } from "@/features/playground/lib/presence-editor";
import { useFileExplorer } from "./useFileExplorer";

type OpenSession = {
  session: CollaborationSession;
  status: CollaborationStatus;
  error: string | null;
  presence: Record<string, unknown> | null;
  dispose: () => void;
};

// Awareness is an imperative lifecycle resource, kept outside React state.
function setSessionVisibility(entry: OpenSession, visible: boolean) {
  if (visible && entry.presence) {
    const presence = entry.presence;
    entry.presence = null;
    entry.session.awareness.setLocalState(presence);
  } else if (!visible && entry.session.awareness.getLocalState()) {
    entry.presence = entry.session.awareness.getLocalState();
    entry.session.awareness.setLocalState(null);
  }
}

/** Keep open-file transports/bindings alive while navigating. Closing a socket
 * on every switch can drop an edit waiting for server-side authorization. */
export function useCollaborativeEditor({ enabled, playgroundId, filePath, editorInstance }: {
  enabled: boolean; playgroundId?: string; filePath?: string;
  editorInstance: editor.IStandaloneCodeEditor | null;
}) {
  const [status, setStatus] = useState<CollaborationStatus | "disabled">(enabled ? "connecting" : "disabled");
  const [participantCount, setParticipantCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessions = useRef(new Map<string, OpenSession>());
  const activePath = useRef(filePath);
  activePath.current = filePath;
  const retry = useCallback(() => sessions.current.get(activePath.current || "")?.session.retry(), []);
  const getDiagnostics = useCallback(() => sessions.current.get(activePath.current || "")?.session.applicationTiming.snapshot() ?? null, []);

  useEffect(() => {
    const entries = sessions.current;
    const unsubscribe = useFileExplorer.subscribe(state => {
      if (state.playgroundId !== playgroundId) return;
      for (const [path, entry] of entries) {
        if (!state.openFiles.some(file => file.id === path)) { entries.delete(path); entry.dispose(); }
      }
    });
    return () => {
      unsubscribe();
      entries.forEach(entry => entry.dispose());
      entries.clear();
    };
  }, [enabled, playgroundId, editorInstance]);

  useEffect(() => {
    if (!enabled || !playgroundId || !filePath || !editorInstance) {
      setStatus("disabled"); setParticipantCount(1); setErrorMessage(null);
      return;
    }
    const mountedEditor = editorInstance;
    let entry = sessions.current.get(filePath);
    if (!entry) {
      const model = mountedEditor.getModel();
      if (!model) return;
      const document = new Y.Doc();
      const presenceEditor = createPresenceEditor(mountedEditor);
      let disposed = false;
      let binding: MonacoBinding | undefined;
      let modelListener: { dispose: () => void } | undefined;
      const session = new CollaborationSession({
        document, WebSocket, isOnline: () => navigator.onLine, networkEvents: window,
        onState: (state, message) => {
          if (disposed) return;
          currentEntry.status = state; currentEntry.error = message;
          if (activePath.current === filePath) { setStatus(state); setErrorMessage(message); }
          else if (state === "connected") {
            currentEntry.presence = { ...currentEntry.presence, ...session.awareness.getLocalState() };
            session.awareness.setLocalState(null);
          }
        },
        getToken: async signal => {
          const response = await fetch("/api/collaboration/token", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, playgroundId, filePath }), signal,
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            const failure = errorResponseSchema.safeParse(body);
            throw new CollaborationProtocolError(failure.success ? failure.data.error.code : response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : "UNAVAILABLE");
          }
          const result = parseTokenResponse(body);
          if (result.data.playgroundId !== playgroundId || result.data.filePath !== filePath) throw new CollaborationProtocolError("ROOM_MISMATCH");
          return result.data;
        },
        onSynced: () => {
          if (disposed || binding || model.isDisposed()) return;
          const sharedText = document.getText("content");
          // The server hydrates every room. Empty text may be a real deletion.
          binding = new MonacoBinding(sharedText, model, new Set([presenceEditor.editor]), session.awareness);
          const updateDraft = () => {
            const state = useFileExplorer.getState();
            if (state.playgroundId === playgroundId && state.openFiles.some(file => file.id === filePath)) state.updateFileContent(filePath, model.getValue());
          };
          // Inactive models also receive normal collaborative edits. Preserve
          // their current text in the workspace instead of restoring stale props.
          modelListener = model.onDidChangeContent(updateDraft);
          updateDraft();
          if (activePath.current !== filePath) {
            currentEntry.presence = { ...currentEntry.presence, ...session.awareness.getLocalState() };
            session.awareness.setLocalState(null);
          }
        },
      });
      const updateParticipants = () => {
        if (!disposed && activePath.current === filePath) setParticipantCount(session.awareness.getStates().size || 1);
      };
      const currentEntry: OpenSession = {
        session, status: "connecting", error: null, presence: null,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          modelListener?.dispose(); binding?.destroy(); presenceEditor.dispose();
          session.awareness.off("change", updateParticipants);
          session.dispose(); document.destroy();
        },
      };
      entry = currentEntry;
      sessions.current.set(filePath, entry);
      session.awareness.on("change", updateParticipants);
      session.start();
    }
    for (const [path, candidate] of sessions.current) {
      setSessionVisibility(candidate, path === filePath);
    }
    setStatus(entry.status); setErrorMessage(entry.error);
    setParticipantCount(entry.session.awareness.getStates().size || 1);
  }, [editorInstance, enabled, filePath, playgroundId]);

  return { status, participantCount, errorMessage, retry, getDiagnostics };
}

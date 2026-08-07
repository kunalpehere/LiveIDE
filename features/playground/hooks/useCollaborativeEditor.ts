import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";

type CollaborationStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

interface TokenResponse {
  success: true;
  data: {
    websocketUrl: string;
    token: string;
    room: string;
    user: { id: string; name: string; color: string };
  };
}

export function useCollaborativeEditor({
  enabled,
  playgroundId,
  filePath,
  initialContent,
  editorInstance,
}: {
  enabled: boolean;
  playgroundId?: string;
  filePath?: string;
  initialContent: string;
  editorInstance: editor.IStandaloneCodeEditor | null;
}) {
  const [status, setStatus] = useState<CollaborationStatus>(enabled ? "connecting" : "disabled");
  const [participantCount, setParticipantCount] = useState(1);
  const initialContentRef = useRef(initialContent);
  initialContentRef.current = initialContent;

  useEffect(() => {
    if (!enabled || !playgroundId || !filePath || !editorInstance) {
      setStatus("disabled");
      setParticipantCount(1);
      return;
    }
    const mountedEditor = editorInstance;

    const controller = new AbortController();
    let disposed = false;
    let document: Y.Doc | undefined;
    let provider: WebsocketProvider | undefined;
    let binding: MonacoBinding | undefined;
    setStatus("connecting");

    async function connect() {
      try {
        const response = await fetch("/api/collaboration/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playgroundId, filePath }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Collaboration authorization failed");
        const result = await response.json() as TokenResponse;
        if (disposed) return;

        document = new Y.Doc();
        provider = new WebsocketProvider(result.data.websocketUrl, result.data.room, document, {
          params: { token: result.data.token },
        });
        provider.awareness.setLocalStateField("user", result.data.user);
        const updateParticipants = () => setParticipantCount(provider?.awareness.getStates().size || 1);
        provider.awareness.on("change", updateParticipants);
        provider.on("status", (event: { status: "connected" | "disconnected" | "connecting" }) =>
          setStatus(event.status === "connected" ? "connected" : event.status));
        provider.on("connection-error", () => setStatus("error"));
        provider.on("sync", (synced: boolean) => {
          if (!synced || disposed || !document || !provider || binding) return;
          const sharedText = document.getText("content");
          if (sharedText.length === 0 && initialContentRef.current) sharedText.insert(0, initialContentRef.current);
          const model = mountedEditor.getModel();
          if (!model) return;
          binding = new MonacoBinding(sharedText, model, new Set([mountedEditor]), provider.awareness);
          updateParticipants();
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Real-time collaboration unavailable", error);
          setStatus("error");
        }
      }
    }

    void connect();
    return () => {
      disposed = true;
      controller.abort();
      binding?.destroy();
      provider?.awareness.setLocalState(null);
      provider?.destroy();
      document?.destroy();
    };
  }, [editorInstance, enabled, filePath, playgroundId]);

  return { status, participantCount };
}

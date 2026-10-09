"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { CollaborationSession, type CollaborationStatus } from "@/lib/collaboration-session";
import { PROJECT_PRESENCE_PATH, PROTOCOL_VERSION, parseTokenResponse, errorResponseSchema, CollaborationProtocolError } from "@/lib/collaboration-protocol.mjs";
import { useFileExplorer } from "./useFileExplorer";
import { applyFollowView, fileAtPath, participantSchema, type FollowParticipant } from "../lib/follow-presence";

export function useFollowCollaborator({ enabled, playgroundId, filePath, editorInstance }: {
  enabled: boolean; playgroundId?: string; filePath?: string; editorInstance: editor.IStandaloneCodeEditor | null;
}) {
  const [participants, setParticipants] = useState<FollowParticipant[]>([]);
  const [following, setFollowing] = useState<number | null>(null);
  const [status, setStatus] = useState<CollaborationStatus | "disabled">("disabled");
  const [message, setMessage] = useState<string | null>(null);
  const targetRef = useRef<number | null>(null);
  const sessionRef = useRef<CollaborationSession | null>(null);
  const applying = useRef(false);
  const pathRef = useRef(filePath);
  pathRef.current = filePath;
  const applyRef = useRef<() => void>(() => {});
  const publishRef = useRef<() => void>(() => {});
  const stop = useCallback((reason?: string) => {
    targetRef.current = null;
    setFollowing(null);
    setMessage(reason ?? null);
    sessionRef.current?.awareness.setLocalStateField("following", null);
  }, []);
  const follow = useCallback((clientId: number) => {
    const peer = participants.find(item => item.clientId === clientId);
    if (status !== "connected" || !peer?.view || peer.following !== null) return;
    targetRef.current = clientId;
    setFollowing(clientId);
    setMessage(null);
    sessionRef.current?.awareness.setLocalStateField("following", clientId);
    applyRef.current();
  }, [participants, status]);

  useEffect(() => {
    if (!enabled || !playgroundId) { setStatus("disabled"); return; }
    let disposed = false;
    const document = new Y.Doc();
    const session = new CollaborationSession({ document, WebSocket, networkEvents: window,
      isOnline: () => navigator.onLine,
      onState: state => {
        if (disposed) return;
        setStatus(state);
        if (state !== "connected") { setParticipants([]); if (targetRef.current !== null) stop("Following stopped: collaboration is unavailable."); }
      },
      onSynced: () => publishRef.current(),
      getToken: async signal => {
        const response = await fetch("/api/collaboration/token", { method: "POST", signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, playgroundId, filePath: PROJECT_PRESENCE_PATH }) });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const failure = errorResponseSchema.safeParse(body);
          throw new CollaborationProtocolError(failure.success ? failure.data.error.code : "UNAVAILABLE");
        }
        const data = parseTokenResponse(body).data;
        if (data.playgroundId !== playgroundId || data.filePath !== PROJECT_PRESENCE_PATH) throw new CollaborationProtocolError("ROOM_MISMATCH");
        return data;
      },
    });
    sessionRef.current = session;
    session.awareness.setLocalStateField("following", null);
    session.awareness.setLocalStateField("view", null);
    const peers = () => Array.from(session.awareness.getStates()).flatMap(([clientId, state]) => {
      const parsed = participantSchema.safeParse(state);
      return clientId !== document.clientID && parsed.success ? [{ ...parsed.data, clientId }] : [];
    });
    const apply = () => {
      if (targetRef.current === null) return;
      const peer = peers().find(item => item.clientId === targetRef.current);
      if (!peer || !peer.view || peer.following !== null) { stop("Following stopped: the participant left, closed their file, or started following someone."); return; }
      const state = useFileExplorer.getState();
      if (state.playgroundId !== playgroundId || !state.templateData) return;
      const file = fileAtPath(state.templateData, peer.view.filePath);
      if (!file) { stop("Following stopped: this file is unavailable in your project."); return; }
      if (pathRef.current !== peer.view.filePath) state.openFile(file, "follow");
    };
    applyRef.current = apply;
    const update = () => { if (!disposed) { setParticipants(peers()); apply(); } };
    session.awareness.on("change", update);
    const unsubscribe = useFileExplorer.subscribe((state, previous) => {
      if (state.navigationVersion !== previous.navigationVersion) stop();
    });
    session.start();
    return () => {
      disposed = true;
      unsubscribe();
      targetRef.current = null;
      setFollowing(null); setParticipants([]); setMessage(null);
      sessionRef.current = null;
      applyRef.current = () => {};
      session.awareness.off("change", update);
      session.dispose(); document.destroy();
    };
  }, [enabled, playgroundId, stop]);

  useEffect(() => {
    const target = editorInstance;
    if (!target) return;
    const publish = () => {
      const selection = target.getSelection();
      const view = pathRef.current && selection ? { filePath: pathRef.current,
        selection: { selectionStartLineNumber: selection.selectionStartLineNumber, selectionStartColumn: selection.selectionStartColumn,
          positionLineNumber: selection.positionLineNumber, positionColumn: selection.positionColumn },
        scrollTop: target.getScrollTop(), scrollLeft: target.getScrollLeft() } : null;
      sessionRef.current?.awareness.setLocalStateField("view", view);
    };
    publishRef.current = publish;
    const apply = () => {
      const state = sessionRef.current?.awareness.getStates().get(targetRef.current ?? -1);
      const peer = participantSchema.safeParse(state);
      if (!peer.success || !peer.data.view || peer.data.view.filePath !== pathRef.current) return;
      applying.current = true;
      try { applyFollowView(target, peer.data.view); } finally { applying.current = false; }
    };
    const awareness = sessionRef.current?.awareness;
    awareness?.on("change", apply);
    const listeners = [
      target.onDidChangeCursorSelection(event => {
        if (applying.current) return;
        if (!applying.current && (event.source === "mouse" || event.source === "keyboard")) stop();
        publish();
      }),
      target.onDidScrollChange(() => { if (!applying.current) publish(); }),
      target.onKeyDown(() => stop()),
      target.onMouseDown(() => stop()),
      target.onDidChangeModel(() => { publish(); apply(); }),
    ];
    const dom = target.getDomNode();
    const localScroll = () => stop();
    dom?.addEventListener("wheel", localScroll, { passive: true });
    dom?.addEventListener("touchstart", localScroll, { passive: true });
    publish(); apply();
    return () => {
      listeners.forEach(listener => listener.dispose());
      awareness?.off("change", apply);
      dom?.removeEventListener("wheel", localScroll); dom?.removeEventListener("touchstart", localScroll);
      publishRef.current = () => {};
    };
  }, [editorInstance, filePath, enabled, playgroundId, stop]);

  // Reapply after follow activation even if the target has not moved again.
  useEffect(() => {
    if (following === null || !editorInstance) return;
    const peer = participants.find(item => item.clientId === following);
    if (!peer?.view || peer.view.filePath !== filePath) return;
    applying.current = true;
    try { applyFollowView(editorInstance, peer.view); } finally { applying.current = false; }
  }, [following, participants, editorInstance, filePath]);

  return { participants, following, status, message, follow, stop: () => stop(), retry: () => sessionRef.current?.retry() };
}

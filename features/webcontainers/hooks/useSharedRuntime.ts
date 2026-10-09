"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CollaborationStatus } from "@/lib/collaboration-session";
import { SharedRuntimeSession, type RuntimeOperation, type RuntimePeer, type RuntimePresence } from "../service/shared-runtime-session";

export function useSharedRuntime({ playgroundId, enabled, canEdit, phase, previewReady, subscribeOutput, execute }: {
  playgroundId: string; enabled: boolean; canEdit: boolean; phase: RuntimePresence["runtime"]["phase"]; previewReady: boolean;
  subscribeOutput: (listener: (data: string) => void) => () => void; execute: (operation: RuntimeOperation) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<CollaborationStatus | "disabled">("disabled");
  const [peers, setPeers] = useState<RuntimePeer[]>([]);
  const [message, setMessage] = useState("");
  const [controls, setControls] = useState(false);
  const current = useRef<SharedRuntimeSession | null>(null);
  const executeRef = useRef(execute); executeRef.current = execute;
  useEffect(() => {
    setPeers([]); setControls(false); setMessage("");
    if (!enabled) { setStatus("disabled"); return; }
    const session = new SharedRuntimeSession({ playgroundId, canEdit,
      execute: operation => executeRef.current(operation),
      onChange: (state, participants, detail) => { setStatus(state); setPeers(participants); if (detail) setMessage(detail); if (state !== "connected") setControls(false); },
    });
    current.current = session; const unsubscribe = subscribeOutput(data => session.output(data)); session.start();
    return () => { current.current = null; unsubscribe(); session.dispose(); };
  }, [enabled, playgroundId, canEdit, subscribeOutput]);
  useEffect(() => { current.current?.update(phase, previewReady); }, [phase, previewReady, enabled, playgroundId, canEdit]);
  const allowControls = useCallback((allowed: boolean) => { current.current?.allowControls(allowed); setControls(allowed); }, []);
  const request = useCallback((clientId: number, operation: RuntimeOperation) => current.current?.request(clientId, operation), []);
  const retry = useCallback(() => current.current?.retry(), []);
  return { status, peers, message, controls, allowControls, request, retry };
}

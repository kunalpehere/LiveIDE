"use client";

import { useEffect, useRef, useState } from "react";
import type { TimingWindow } from "@/lib/collaboration-metrics.mjs";
import { serverDiagnosticsSchema } from "@/lib/collaboration-metrics.mjs";
type Summary = ReturnType<TimingWindow["snapshot"]>;

export function CollaborationDiagnostics({ playgroundId, status, getSnapshot }: {
  playgroundId?: string; status: string; getSnapshot: () => Summary | null;
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<Summary | null>(null);
  const [server, setServer] = useState<ReturnType<typeof serverDiagnosticsSchema.parse> | null>(null);
  const [probe, setProbe] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function refresh() {
    setClient(getSnapshot()); setServer(null); setProbe(null); setMessage(null);
    if (!playgroundId) return;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true);
    try {
      const response = await fetch(`/api/collaboration/diagnostics?playgroundId=${encodeURIComponent(playgroundId)}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const result = await response.json();
      const parsed = serverDiagnosticsSchema.parse(result.server);
      if (!Number.isFinite(result.serviceProbeMs) || result.serviceProbeMs < 0) throw new Error("Invalid timing");
      if (!controller.signal.aborted) { setServer(parsed); setProbe(result.serviceProbeMs); }
    } catch { if (!controller.signal.aborted) setMessage("Server measurements unavailable. Start the configured collaboration service."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const format = (sample: Summary | null) => sample?.samples ? `${sample.p50Ms.toFixed(2)} / ${sample.p95Ms.toFixed(2)} ms (${sample.samples} samples)` : "No samples";
  return <div className="absolute left-3 bottom-3 z-20 max-w-sm rounded border bg-background/95 p-2 text-xs shadow">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) setClient(getSnapshot()); }}>Collaboration diagnostics</button>
    {open && <div className="mt-2 space-y-2" role="region" aria-label="Collaboration diagnostics">
      <p>Connection: {status}</p>
      <p>Client apply p50 / p95: {format(client)}</p>
      <p>Server processing p50 / p95: {format(server?.processing ?? null)}</p>
      <p>Authorization p50 / p95: {format(server?.authorization ?? null)}</p>
      <p>Service HTTP probe: {probe === null ? "Not measured" : `${probe.toFixed(2)} ms`}</p>
      {server && <p>Active server sockets: {server.activeSockets}</p>}
      <p className="text-muted-foreground">Server values cover this process. The HTTP probe runs from the app server; it does not measure browser WebSocket latency. Apply timing includes synchronous Yjs/Monaco work, excluding paint.</p>
      {message && <p role="status">{message}</p>}
      <button type="button" onClick={refresh} disabled={busy} className="underline">{busy ? "Refreshing…" : "Refresh measurements"}</button>
    </div>}
  </div>;
}

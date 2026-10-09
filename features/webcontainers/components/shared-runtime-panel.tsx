"use client";
import type { ReturnTypeOfSharedRuntime } from "../types/shared-runtime";
import { Button } from "@/components/ui/button";
import { runtimeEventLabels, runtimeOperationAllowed } from "@/lib/shared-runtime.mjs";

export default function SharedRuntimePanel({ sharing, canEdit, onClose }: { sharing: ReturnTypeOfSharedRuntime; canEdit: boolean; onClose: () => void }) {
  return <aside aria-label="Shared runtimes" className="fixed bottom-0 right-0 top-14 z-40 flex w-full max-w-lg flex-col border-l bg-background shadow-xl">
    <header className="flex items-center justify-between border-b p-4"><h2 className="font-semibold">Shared runtimes</h2><Button size="sm" variant="ghost" onClick={onClose} aria-label="Close shared runtimes">Close</Button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <p className="text-xs text-muted-foreground">Each runtime runs in its host&apos;s browser. Shared diagnostics contain fixed event labels; raw terminal output and preview URLs stay local.</p>
      <p role="status" className="text-xs">Runtime sharing: {sharing.status}</p>
      {sharing.message && <p role="status" className="text-xs">{sharing.message}</p>}
      {sharing.status === "failed" && <Button size="sm" onClick={sharing.retry}>Retry runtime sharing</Button>}
      {canEdit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sharing.controls} disabled={sharing.status !== "connected"} onChange={event => sharing.allowControls(event.target.checked)} />Allow editors to control my runtime</label>}
      {!canEdit && <p className="text-xs text-muted-foreground">Viewers can observe shared runtimes. Runtime operations and terminal input are unavailable.</p>}
      {sharing.peers.length === 0 && <p className="text-sm text-muted-foreground">No other runtime participants online.</p>}
      {sharing.peers.map(peer => <section key={peer.clientId} aria-label={`Runtime hosted by ${peer.user.name}`} className="space-y-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">{peer.user.name}&apos;s browser</h3>
        <p className="text-xs">Process: {peer.runtime.phase} · Preview: {peer.runtime.previewReady ? "server ready" : "not ready"}</p>
        <p className="text-xs text-muted-foreground">Remote controls {peer.runtime.controls ? "enabled by host" : "disabled"}</p>
        {canEdit && <div className="flex gap-2">{(["start", "stop", "restart"] as const).map(operation => <Button key={operation} size="sm" variant="outline" disabled={!peer.runtime.controls || sharing.status !== "connected" || !runtimeOperationAllowed(operation, peer.runtime.phase)} onClick={() => void sharing.request(peer.clientId, operation)}>Request {operation}</Button>)}</div>}
        <ol className="max-h-48 space-y-1 overflow-auto rounded bg-muted/30 p-2 text-xs" aria-label={`Shared diagnostics from ${peer.user.name}`}>
          {peer.runtime.logs.map(log => <li key={log.sequence}>{runtimeEventLabels[log.event]}</li>)}
          {!peer.runtime.logs.length && <li>No diagnostic events yet.</li>}
        </ol>
      </section>)}
    </div>
  </aside>;
}

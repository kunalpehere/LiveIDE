"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmationDialog } from "./dialogs/confirmation-dialog";
import {
  createPlaygroundSnapshot,
  deletePlaygroundSnapshot,
  listPlaygroundHistory,
  restorePlaygroundSnapshot,
} from "../actions/history";

type Role = "OWNER" | "EDITOR" | "VIEWER";
interface Snapshot {
  id: string; name: string; kind: string; templateVersion: number;
  createdById: string; createdByName: string; createdAt: Date | string;
}
interface HistoryEvent {
  id: string; type: string; actorName: string; snapshotName: string | null; createdAt: Date | string;
  snapshotVersion?: number | null; previousVersion?: number | null; resultingVersion?: number | null;
  restorePointId?: string | null; restorePointName?: string | null;
}
interface HistoryState { currentRole: Role; snapshots: Snapshot[]; events: HistoryEvent[]; currentVersion: number;
  retention: { count: number; limit: number; remaining: number } }

export function PlaygroundHistoryDialog({ playgroundId, hasUnsavedChanges }: { playgroundId: string; hasUnsavedChanges: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  const operationPending = useRef(false);
  async function mutate(action: () => Promise<unknown>) {
    if (operationPending.current) return;
    operationPending.current = true;
    setPending(true);
    try { await action(); }
    catch { toast.error("History could not be updated. Refresh history and try again."); }
    finally { operationPending.current = false; setPending(false); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listPlaygroundHistory(playgroundId);
    setLoading(false);
    if (!result.success) return toast.error(result.message);
    setHistory(result.data as HistoryState);
  }, [playgroundId]);
  useEffect(() => { if (open) void load(); }, [load, open]);

  const canEdit = history?.currentRole === "OWNER" || history?.currentRole === "EDITOR";
  async function createSnapshot() {
    if (hasUnsavedChanges) return toast.error("Save all changes before creating a snapshot");
    const result = await createPlaygroundSnapshot(playgroundId, name);
    if (!result.success) return toast.error(result.message);
    setName("");
    toast.success("Snapshot created");
    await load();
  }
  async function restore() {
    if (!restoreTarget) return;
    if (hasUnsavedChanges) return toast.error("Save all changes before restoring a snapshot");
    const result = await restorePlaygroundSnapshot(playgroundId, restoreTarget.id, history?.currentVersion);
    if (!result.success) return toast.error(result.message);
    toast.success(`Restored ${restoreTarget.name}`);
    window.location.reload();
  }
  async function remove(snapshot: Snapshot) {
    const result = await deletePlaygroundSnapshot(playgroundId, snapshot.id);
    if (!result.success) return toast.error(result.message);
    toast.success("Snapshot deleted");
    await load();
  }

  return <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><History className="h-4 w-4" />History</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Project history</DialogTitle><DialogDescription>Create named versions and restore earlier saved states.</DialogDescription></DialogHeader>
        <Button size="sm" variant="outline" disabled={loading || pending} onClick={() => void load()}>Refresh history</Button>
        {loading && !history ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : <Tabs defaultValue="snapshots">
          <TabsList><TabsTrigger value="snapshots">Snapshots</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
          <TabsContent value="snapshots" className="space-y-3">
            {history && <p className="text-xs text-muted-foreground">{history.retention.count}/{history.retention.limit} snapshots retained. Named snapshots and automatic restore points share this limit. Only the owner can delete them; none expire automatically.</p>}
            {history?.retention.remaining === 0 && <p className="text-xs text-amber-600">History is full. Ask the owner to delete an unused snapshot before creating one or restoring.</p>}
            {canEdit && <div className="flex gap-2">
              <Input aria-label="Snapshot name" placeholder="Before dependency upgrade" value={name} onChange={event => setName(event.target.value)} />
              <Button onClick={() => void mutate(createSnapshot)} disabled={!name.trim() || loading || pending || hasUnsavedChanges || history?.retention.remaining === 0}>Create</Button>
            </div>}
            {hasUnsavedChanges && canEdit && <p className="text-xs text-amber-600">Save all changes before creating or restoring a snapshot.</p>}
            <ScrollArea className="h-80 pr-3"><div className="space-y-2">
              {history?.snapshots.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No snapshots yet.</p>}
              {history?.snapshots.map(snapshot => <div key={snapshot.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{snapshot.name}</p><Badge variant="outline">{snapshot.kind === "RESTORE_POINT" ? "Restore point" : "Manual"}</Badge></div><p className="text-xs text-muted-foreground">{snapshot.createdByName} · {new Date(snapshot.createdAt).toLocaleString()} · v{snapshot.templateVersion}</p></div>
                {canEdit && <Button size="sm" variant="outline" disabled={hasUnsavedChanges || pending || loading || history.retention.remaining === 0} onClick={() => setRestoreTarget(snapshot)}><RotateCcw className="h-3 w-3" />Restore</Button>}
                {history.currentRole === "OWNER" && <Button size="icon" variant="ghost" disabled={pending || loading} aria-label={`Delete ${snapshot.name}`} onClick={() => void mutate(() => remove(snapshot))}><Trash2 className="h-4 w-4" /></Button>}
              </div>)}
            </div></ScrollArea>
          </TabsContent>
          <TabsContent value="activity"><ScrollArea className="h-80 pr-3"><div className="space-y-2">
            {history?.events.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No history activity yet.</p>}
            {history?.events.map(event => <div key={event.id} className="rounded-md border p-3"><p className="text-sm">{event.actorName} {eventLabel(event.type)} <span className="font-medium">{event.snapshotName}</span></p><p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p>
              {event.type === "SNAPSHOT_RESTORED" && event.previousVersion != null && event.resultingVersion != null && <p className="text-xs text-muted-foreground">Saved v{event.previousVersion} → v{event.resultingVersion}{event.snapshotVersion != null ? ` from snapshot v${event.snapshotVersion}` : ""}. Safety snapshot: {event.restorePointName || "Unavailable"}.</p>}
            </div>)}
          </div></ScrollArea></TabsContent>
        </Tabs>}
      </DialogContent>
    </Dialog>
    <ConfirmationDialog
      isOpen={Boolean(restoreTarget)} setIsOpen={value => { if (!value) setRestoreTarget(null); }}
      title={`Restore ${restoreTarget?.name || "snapshot"}?`}
      description="The current saved project becomes an automatic restore point. Everyone must reload to enter the restored collaboration revision."
      confirmLabel="Restore" isPending={pending} onConfirm={() => void mutate(restore)} onCancel={() => setRestoreTarget(null)}
    />
  </>;
}

function eventLabel(type: string) {
  if (type === "SNAPSHOT_CREATED") return "created";
  if (type === "SNAPSHOT_RESTORED") return "restored";
  if (type === "SNAPSHOT_DELETED") return "deleted";
  return "updated";
}

"use client";

import { useCallback, useEffect, useState } from "react";
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
}
interface HistoryState { currentRole: Role; snapshots: Snapshot[]; events: HistoryEvent[] }

export function PlaygroundHistoryDialog({ playgroundId, hasUnsavedChanges }: { playgroundId: string; hasUnsavedChanges: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null);

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
    const result = await restorePlaygroundSnapshot(playgroundId, restoreTarget.id);
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
        {loading && !history ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : <Tabs defaultValue="snapshots">
          <TabsList><TabsTrigger value="snapshots">Snapshots</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
          <TabsContent value="snapshots" className="space-y-3">
            {canEdit && <div className="flex gap-2">
              <Input aria-label="Snapshot name" placeholder="Before dependency upgrade" value={name} onChange={event => setName(event.target.value)} />
              <Button onClick={() => void createSnapshot()} disabled={!name.trim() || loading || hasUnsavedChanges}>Create</Button>
            </div>}
            {hasUnsavedChanges && canEdit && <p className="text-xs text-amber-600">Save all changes before creating or restoring a snapshot.</p>}
            <ScrollArea className="h-80 pr-3"><div className="space-y-2">
              {history?.snapshots.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No snapshots yet.</p>}
              {history?.snapshots.map(snapshot => <div key={snapshot.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{snapshot.name}</p><Badge variant="outline">{snapshot.kind === "RESTORE_POINT" ? "Restore point" : "Manual"}</Badge></div><p className="text-xs text-muted-foreground">{snapshot.createdByName} · {new Date(snapshot.createdAt).toLocaleString()} · v{snapshot.templateVersion}</p></div>
                {canEdit && <Button size="sm" variant="outline" disabled={hasUnsavedChanges} onClick={() => setRestoreTarget(snapshot)}><RotateCcw className="h-3 w-3" />Restore</Button>}
                {history.currentRole === "OWNER" && <Button size="icon" variant="ghost" aria-label={`Delete ${snapshot.name}`} onClick={() => void remove(snapshot)}><Trash2 className="h-4 w-4" /></Button>}
              </div>)}
            </div></ScrollArea>
          </TabsContent>
          <TabsContent value="activity"><ScrollArea className="h-80 pr-3"><div className="space-y-2">
            {history?.events.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No history activity yet.</p>}
            {history?.events.map(event => <div key={event.id} className="rounded-md border p-3"><p className="text-sm">{event.actorName} {eventLabel(event.type)} <span className="font-medium">{event.snapshotName}</span></p><p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p></div>)}
          </div></ScrollArea></TabsContent>
        </Tabs>}
      </DialogContent>
    </Dialog>
    <ConfirmationDialog
      isOpen={Boolean(restoreTarget)} setIsOpen={value => { if (!value) setRestoreTarget(null); }}
      title={`Restore ${restoreTarget?.name || "snapshot"}?`}
      description="The current saved project becomes an automatic restore point. Everyone must reload to enter the restored collaboration revision."
      confirmLabel="Restore" onConfirm={() => void restore()} onCancel={() => setRestoreTarget(null)}
    />
  </>;
}

function eventLabel(type: string) {
  if (type === "SNAPSHOT_CREATED") return "created";
  if (type === "SNAPSHOT_RESTORED") return "restored";
  if (type === "SNAPSHOT_DELETED") return "deleted";
  return "updated";
}


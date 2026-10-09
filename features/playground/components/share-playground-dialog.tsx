"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InvitationManager } from "./invitation-manager";
import {
  invitePlaygroundCollaborator,
  listPlaygroundCollaborators,
  removePlaygroundCollaborator,
  updatePlaygroundCollaborator,
} from "../actions/collaboration";

type MemberRole = "EDITOR" | "VIEWER";
interface Person { id: string; name: string | null; email: string; image: string | null }
interface Member { id: string; role: MemberRole; user: Person }
interface SharingState { currentRole: "OWNER" | MemberRole; owner: Person | null; members: Member[] }

export function SharePlaygroundDialog({ playgroundId }: { playgroundId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("EDITOR");
  const [sharing, setSharing] = useState<SharingState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPlaygroundCollaborators(playgroundId);
      if (!result.success) { setSharing(null); return toast.error(result.message); }
      setSharing(result.data as SharingState);
    } catch { toast.error("Could not load members. Please try again."); }
    finally { setLoading(false); }
  }, [playgroundId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function invite() {
    setLoading(true);
    try {
      const result = await invitePlaygroundCollaborator(playgroundId, { email, role });
      if (!result.success) return toast.error(result.message);
      setEmail("");
      toast.success("Collaborator added");
      await load();
    } catch { toast.error("Could not add this member. Please try again."); }
    finally { setLoading(false); }
  }

  async function update(memberId: string, nextRole: MemberRole) {
    setLoading(true);
    try {
      const result = await updatePlaygroundCollaborator(playgroundId, memberId, nextRole);
      if (!result.success) return toast.error(result.message);
      await load();
    } catch { toast.error("Could not change this role. Please try again."); }
    finally { setLoading(false); }
  }

  async function remove(memberId: string) {
    setLoading(true);
    try {
      const result = await removePlaygroundCollaborator(playgroundId, memberId);
      if (!result.success) return toast.error(result.message);
      toast.success("Collaborator removed");
      await load();
    } catch { toast.error("Could not remove this member. Please try again."); }
    finally { setLoading(false); }
  }

  const canManage = sharing?.currentRole === "OWNER";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Share2 className="h-4 w-4" />Share</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share playground</DialogTitle>
          <DialogDescription>Editors can change code. Viewers have read-only access.</DialogDescription>
        </DialogHeader>
        {loading && !sharing ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : <div className="space-y-4">
          {canManage && <p className="text-xs text-muted-foreground">Add an existing user by email to grant access immediately, or create an invitation link below.</p>}
          {canManage && <div className="flex flex-wrap gap-2">
            <Input aria-label="Collaborator email" placeholder="collaborator@example.com" value={email} onChange={event => setEmail(event.target.value)} />
            <Select value={role} onValueChange={value => setRole(value as MemberRole)}>
              <SelectTrigger aria-label="New member role" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="EDITOR">Editor</SelectItem><SelectItem value="VIEWER">Viewer</SelectItem></SelectContent>
            </Select>
            <Button onClick={() => void invite()} disabled={!email.trim() || loading}>Add member</Button>
          </div>}
          <div className="space-y-2">
            {sharing?.owner && <PersonRow person={sharing.owner} label="Owner" />}
            {sharing?.members.map(member => <div key={member.id} className="flex items-center gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.user.name || member.user.email}</p><p className="truncate text-xs text-muted-foreground">{member.user.email}</p></div>
              {canManage ? <>
                <Select disabled={loading} value={member.role} onValueChange={value => void update(member.id, value as MemberRole)}>
                  <SelectTrigger aria-label={`Role for ${member.user.email}`} className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="EDITOR">Editor</SelectItem><SelectItem value="VIEWER">Viewer</SelectItem></SelectContent>
                </Select>
                <Button disabled={loading} size="icon" variant="ghost" aria-label={`Remove ${member.user.email}`} onClick={() => void remove(member.id)}><Trash2 className="h-4 w-4" /></Button>
              </> : <span className="text-xs text-muted-foreground">{member.role === "EDITOR" ? "Editor" : "Viewer"}</span>}
            </div>)}
          </div>
          {canManage && open && <InvitationManager playgroundId={playgroundId} />}
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({ person, label }: { person: Person; label: string }) {
  return <div className="flex items-center rounded-md border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{person.name || person.email}</p><p className="truncate text-xs text-muted-foreground">{person.email}</p></div><span className="text-xs text-muted-foreground">{label}</span></div>;
}

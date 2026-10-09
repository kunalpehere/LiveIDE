"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPlaygroundInvitation, listPlaygroundInvitations, revokePlaygroundInvitation } from "../actions/invitations";

type Invitation = { id: string; role: "EDITOR" | "VIEWER"; expiresAt: Date; state: "PENDING" | "USED" | "REVOKED" | "EXPIRED" };
export function InvitationManager({ playgroundId }: { playgroundId: string }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [expiryHours, setExpiryHours] = useState<1 | 24 | 168>(24);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await listPlaygroundInvitations(playgroundId);
      if (result.success) setInvitations(result.data);
      else setMessage(result.message);
    } catch { setMessage("Could not load invitations. Close and reopen Share to retry."); }
  }, [playgroundId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);
  async function create() {
    setBusy(true); setMessage(""); setLink(null);
    try {
      const result = await createPlaygroundInvitation(playgroundId, { role, expiryHours });
      if (!result.success) { setMessage(result.message); return; }
      setLink({ id: result.data.id, url: new URL(result.data.path, window.location.origin).href });
      setMessage("Invitation created. Copy this link now; it is only shown once.");
      await load();
    } catch { setMessage("Could not create an invitation. Please try again."); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setMessage("");
    try {
      const result = await revokePlaygroundInvitation(playgroundId, id);
      setMessage(result.success ? "Invitation revoked. Existing memberships are unchanged." : result.message);
      if (result.success && link?.id === id) setLink(null);
      await load();
    } catch { setMessage("Could not revoke this invitation. Please try again."); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setMessage("Invitation link copied."); }
    catch { setMessage("Select and copy the invitation link below."); }
  }
  return <section className="space-y-3 border-t pt-4" aria-label="Invitation links">
    <h3 className="text-sm font-semibold">Invitation links</h3>
    <p className="text-xs text-muted-foreground">Anyone with a link can sign in and accept it once. Access begins after acceptance.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">Role<select aria-label="Invitation role" className="rounded-md border bg-background p-2 text-sm" value={role} disabled={busy} onChange={event => setRole(event.target.value as typeof role)}>
        <option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option>
      </select></label>
      <label className="grid gap-1 text-xs">Expires in<select aria-label="Invitation expiry" className="rounded-md border bg-background p-2 text-sm" value={expiryHours} disabled={busy} onChange={event => setExpiryHours(Number(event.target.value) as typeof expiryHours)}>
        <option value={1}>1 hour</option><option value={24}>1 day</option><option value={168}>7 days</option>
      </select></label>
      <Button disabled={busy} onClick={() => void create()}>Create invitation</Button>
    </div>
    {link && <div className="flex gap-2"><Input aria-label="Invitation link" readOnly value={link.url} onFocus={event => event.target.select()} /><Button variant="outline" onClick={() => void copy()}>Copy link</Button></div>}
    {message && <p className="text-xs" role="status">{message}</p>}
    {!invitations.length ? <p className="text-xs text-muted-foreground">No invitation links yet.</p> : <ul className="max-h-48 space-y-2 overflow-y-auto">
      {invitations.map(invitation => <li key={invitation.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
        <div className="flex-1"><p>{invitation.role === "EDITOR" ? "Editor" : "Viewer"} · {invitation.state.toLowerCase()}</p><p className="text-muted-foreground">Expires {new Date(invitation.expiresAt).toLocaleString()}</p></div>
        {invitation.state === "PENDING" && <Button size="sm" variant="outline" disabled={busy} aria-label={`Revoke ${invitation.id}`} onClick={() => void revoke(invitation.id)}>Revoke</Button>}
      </li>)}
    </ul>}
    <p className="text-xs text-muted-foreground">Showing the latest 100 invitations. To end accepted access, remove the member above.</p>
  </section>;
}

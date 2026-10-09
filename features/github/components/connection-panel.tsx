"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type Status = { configured: boolean; state: string; login: string | null; access: string | null; writeEnabled?: boolean };

export function GitHubConnectionPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [access, setAccess] = useState("public");
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/github/connection", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setStatus(await response.json());
    } catch { setMessage("Could not load your GitHub connection. Please retry."); }
  }, []);
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("github");
    if (outcome) {
      setMessage(outcome === "connected" ? "GitHub connected successfully." : outcome === "connected-revocation-pending" ? "GitHub connected. Revocation of the previous token could not be confirmed; review authorized apps in GitHub settings." : "GitHub authorization failed or was cancelled. Retry, or revoke previous permissions in GitHub if you are reducing access.");
      window.history.replaceState(null, "", "/dashboard/github");
    }
    void refresh();
  }, [refresh]);
  async function connect() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/github/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access, writeEnabled }) });
      if (!response.ok) throw new Error();
      const result = await response.json();
      const url = new URL(result.url);
      if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/authorize") throw new Error();
      window.location.assign(url.toString());
    } catch { setMessage("Could not start GitHub authorization. Please retry."); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/github/connection", { method: "DELETE" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setMessage(result.revocationPending ? "Disconnected from LiveIDE. GitHub revocation could not be confirmed; remove the repository app in GitHub settings." : "GitHub disconnected and its token revoked.");
      setConfirmDisconnect(false); await refresh();
    } catch { setMessage("Could not disconnect GitHub. Please retry."); }
    finally { setBusy(false); }
  }
  const linked = status && ["connected", "unavailable"].includes(status.state);
  return <section className="space-y-6">
    <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">Back to projects</Link>
    <div><h1 className="text-2xl font-semibold">GitHub connection</h1><p className="mt-2 text-sm text-muted-foreground">Connect repository access separately from your LiveIDE sign-in.</p></div>
    <div className="space-y-4 rounded-xl border bg-card p-6">
      <p aria-live="polite">{!status ? "Loading connection…" : status.state === "connected" ? `Connected as ${status.login} · ${status.access === "private" ? "Public and private repositories" : "Public repositories"}` : status.state === "revoked" ? "GitHub access was revoked. Reconnect to authorize access." : status.state === "unavailable" ? "GitHub access could not be verified. Retry or disconnect." : "GitHub is disconnected."}</p>
      {status && !status.configured && <p className="text-sm text-muted-foreground">GitHub repository connection is not configured. Ask your administrator to enable it.</p>}
      <fieldset disabled={busy || !status?.configured} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Repository access</legend>
        <label className="flex items-center gap-2"><input type="radio" name="access" value="public" checked={access === "public"} onChange={() => setAccess("public")} />Public repositories only</label>
        <label className="flex items-center gap-2"><input type="radio" name="access" value="private" checked={access === "private"} onChange={() => setAccess("private")} />Public and private repositories</label>
      </fieldset>
      {access === "private" && <p className="text-sm text-muted-foreground">GitHub’s private repository permission includes read and write access across repositories you can access. Choose this only if you need private repositories. LiveIDE requires separate commit consent before using writes.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={writeEnabled} disabled={busy || !status?.configured} onChange={event => setWriteEnabled(event.target.checked)} />Enable commits after reviewing and explicitly confirming changes</label>
      <p className="text-sm text-muted-foreground">{writeEnabled ? "Public commit access requests public_repo; private access requests repo. These permissions cover repositories your GitHub account can write. Each publish still needs confirmation." : "Public access requests no repository OAuth scope. Browse and import source files after connecting."}</p>
      {status?.state === "connected" && <p className="text-sm">Commits {status.writeEnabled ? "enabled" : "disabled"} for this connection.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !status?.configured} onClick={connect}>{busy ? "Working…" : linked ? "Reconnect GitHub" : "Connect GitHub"}</Button>
        {status?.state === "connected" && <Button asChild variant="outline"><Link href="/dashboard/github/repositories">Browse repositories</Link></Button>}
        <Button variant="outline" disabled={busy} onClick={refresh}>Refresh status</Button>
        {linked && <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>}
      </div>
      {confirmDisconnect && <div className="space-y-3 rounded-md border p-4"><p>Disconnect repository access from LiveIDE and revoke its GitHub token?</p><Button variant="destructive" disabled={busy} onClick={disconnect}>Confirm disconnect</Button> <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancel</Button></div>}
      <p role="status" className="text-sm">{message}</p>
      <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-sm underline">Manage authorized apps in GitHub</a>
    </div>
  </section>;
}

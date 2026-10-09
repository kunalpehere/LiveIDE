"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileDiff } from "./file-diff";

type Operation = { operationId: string; status: string; branch: string; message: string; changes: { path: string; kind: string }[]; commitSha: string | null; commitUrl: string | null; branchUrl: string; retryAt?: number | null; errorCode?: string | null; error?: string; uploadedFiles?: number };
type Status = { imported: boolean; source: { owner: string; repository: string; branch: string; folder: string; commitSha: string } | null; operation: Operation | null };
type Review = { operationId: string | null; repository: string; sourceBranch: string; folder: string; head: string; branch: string; message: string; conflicts: string[]; changes: { path: string; kind: string; before: string; after: string }[] };
export function GitHubCommitPanel({ projectId, title }: { projectId: string; title: string }) {
  const [status, setStatus] = useState<Status | null>(null), [review, setReview] = useState<Review | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null), [message, setMessage] = useState("Update project from LiveIDE"), [branch, setBranch] = useState("");
  const [confirmed, setConfirmed] = useState(false), [abandon, setAbandon] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [retryAt, setRetryAt] = useState<number | null>(null), [now, setNow] = useState(Date.now);
  const mounted = useRef(true), controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true); setError(""); controller.current?.abort(); const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch(`/api/github/commit?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: active.signal }); const data = await response.json();
      if (active.signal.aborted || !mounted.current) return;
      if (!response.ok) { setError(data.error ?? "Could not load commit status."); return; }
      setStatus(data); setOperation(data.operation); setConfirmed(false); setReview(null); setRetryAt(data.operation?.retryAt ?? null);
    } catch { if (!active.signal.aborted && mounted.current) setError("Could not load commit status. Refresh to recover recorded progress."); }
    finally { if (mounted.current && !active.signal.aborted) setBusy(false); }
  }, [projectId]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; controller.current?.abort(); }; }, [refresh]);
  useEffect(() => { if (!retryAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [retryAt]);
  const pending = operation && ["RUNNING", "RECOVERABLE"].includes(operation.status), blocked = busy || !!(retryAt && retryAt > now);
  async function request(action: "review" | "publish" | "cancel") {
    setBusy(true); setError(""); controller.current?.abort(); const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch("/api/github/commit", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: active.signal,
        body: JSON.stringify(action === "review" ? { action, projectId, message, branch } : { action, operationId: pending ? operation!.operationId : review!.operationId, confirm: true }) });
      const data = await response.json();
      if (active.signal.aborted || !mounted.current) return;
      if (!response.ok) { setError(data.error ?? "Could not complete commit request."); setRetryAt(data.retryAt ?? null); return; }
      if (action === "review") { setReview(data); setOperation(null); setConfirmed(false); }
      else {
        setOperation(data); setReview(null); setConfirmed(false); setAbandon(false); setRetryAt(data.retryAt ?? null);
        if (data.status === "SUCCEEDED") setStatus(current => current ? { ...current, source: current.source ? { ...current.source, branch: data.branch, commitSha: data.commitSha } : null, operation: data } : current);
        if (data.error) setError(data.error);
      }
    } catch { if (mounted.current && !active.signal.aborted) setError("Request interrupted. Refresh commit status to recover progress before making another review."); }
    finally { if (mounted.current && !active.signal.aborted) { setBusy(false); setNow(Date.now()); } }
  }
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Review and commit changes</h1><p className="mt-2 text-sm text-muted-foreground">{title} · Only saved project files are reviewed. Save your edits in the workspace first.</p></div><Button asChild variant="outline"><Link href={`/playground/${projectId}`}>Back to project</Link></Button></div>
    <div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/dashboard/github">Manage GitHub write access</Link></Button><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh commit status</Button></div>
    {busy && <p role="status">Working on GitHub changes…</p>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 p-4">{error}</div>}
    {retryAt && retryAt > now && <p className="text-sm">Retry after {new Date(retryAt).toLocaleTimeString()}.</p>}
    {status?.source && <p className="break-all text-sm">{status.source.owner}/{status.source.repository} · Source branch {status.source.branch} · /{status.source.folder} · {status.source.commitSha.slice(0, 12)}</p>}
    {status && !status.imported && <p>This project has no GitHub import baseline. <Link href="/dashboard/github/repositories" className="underline">Import a repository or folder</Link> to review changes.</p>}
    {operation?.status === "SUCCEEDED" && <div role="status" className="space-y-2 rounded-lg border p-4"><p>Published commit {operation.commitSha?.slice(0, 12)} to {operation.branch}.</p><a href={operation.commitUrl!} target="_blank" rel="noopener noreferrer" className="mr-4 underline">View GitHub commit</a><a href={operation.branchUrl} target="_blank" rel="noopener noreferrer" className="underline">View new branch</a></div>}
    {pending ? <div className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Recorded commit needs {operation.status === "RUNNING" ? "a status check" : "recovery"}</h2>
      <p className="break-all text-sm">Destination {operation.branch} · {operation.message}</p>
      {operation.uploadedFiles !== undefined && <p className="text-xs text-muted-foreground">{operation.uploadedFiles} file uploads completed. Recovery resumes from recorded progress.</p>}
      <ul className="space-y-1 text-sm">{operation.changes.map(change => <li key={change.path}>{change.kind}: <span className="break-all font-mono">{change.path}</span></li>)}</ul>
      <p className="text-sm text-muted-foreground">Recovery uses the snapshot you previously confirmed. Later saved edits remain local. A published branch is verified and retained.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I confirm recovery of this previously reviewed commit.</label>
      <Button disabled={blocked || !confirmed} onClick={() => void request("publish")}>Recover confirmed commit</Button>
      <div className="space-y-2 border-t pt-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={abandon} disabled={busy} onChange={event => setAbandon(event.target.checked)} />Abandon this operation only if its commit has not been published. Leave any Git objects unchanged.</label><Button variant="outline" disabled={blocked || !abandon} onClick={() => void request("cancel")}>Abandon unpublished operation</Button></div>
    </div> : status?.imported && <div className="space-y-4 rounded-lg border p-4">
      {!review ? <><label className="block text-sm">Commit message<textarea aria-label="Commit message" value={message} maxLength={500} disabled={busy} onChange={event => setMessage(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label><label className="block text-sm">New branch name<input aria-label="New branch name" value={branch} maxLength={200} placeholder="Automatic: codex/liveide-…" disabled={busy} onChange={event => setBranch(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label><Button disabled={blocked || !message.trim()} onClick={() => void request("review")}>Review saved changes</Button></> : <>
        <h2 className="font-semibold">Confirm reviewed changes</h2><p className="break-all text-sm">{review.repository} · {review.sourceBranch} at {review.head.slice(0, 12)} → new branch {review.branch}</p><p className="break-words text-sm">Commit message: {review.message}</p>
        {review.conflicts.length > 0 && <div role="alert"><p>Remote files changed or conflict with this project. Resolve these against the current source or import the updated source before reviewing again.</p><ul>{review.conflicts.map(path => <li className="break-all font-mono text-sm" key={path}>{path}</li>)}</ul></div>}
        {!review.changes.length && !review.conflicts.length && <p>No saved changes to commit.</p>}
        {review.changes.map(change => <details key={change.path} className="rounded-md border p-3"><summary className="cursor-pointer break-all text-sm font-medium">{change.kind}: {change.path}</summary><FileDiff path={change.path} before={change.before} after={change.after} /></details>)}
        {review.operationId && <><p className="text-sm text-muted-foreground">Only these changes will be committed. Files outside the import and omitted assets stay in GitHub. Existing branches will remain at their current commits.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I confirm these exact saved changes, commit message and new destination branch.</label><Button disabled={blocked || !confirmed} onClick={() => void request("publish")}>Confirm and publish new branch</Button></>}
        <Button variant="outline" disabled={busy} onClick={() => { setReview(null); setConfirmed(false); }}>Change review</Button>
      </>}
    </div>}
  </section>;
}

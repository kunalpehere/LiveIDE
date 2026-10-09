"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BrowseFailure } from "../types";

type Review = { plan: string; title: string; fileCount: number; bytes: number; folder: string; commitSha: string; template: string;
  omitted: { path: string; reason: string }[] };
export function RepositoryImport({ cursor, folder, defaultTitle, disabled, onBusy }: {
  cursor: string; folder: string; defaultTitle: string; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const [title, setTitle] = useState(defaultTitle.slice(0, 100));
  const [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BrowseFailure | null>(null);
  const [created, setCreated] = useState<{ projectId: string; title: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!error?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [error?.retryAt]);
  const blocked = disabled || busy || !!(error?.retryAt && error.retryAt > now);
  async function request(action: "review" | "create") {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); onBusy(true); setError(null);
    try {
      const response = await fetch("/api/github/import", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: active.signal,
        body: JSON.stringify(action === "review" ? { action, cursor, title } : { action, plan: review!.plan, acceptOmissions: accepted }) });
      const data = await response.json();
      if (active.signal.aborted) return;
      if (!response.ok) { setError({ code: data.code, error: data.error ?? "Could not complete import. Retry to recover safely.", retryAt: data.retryAt }); setNow(Date.now()); return; }
      if (action === "review") { setReview(data); setAccepted(false); }
      else setCreated(data);
    } catch { if (!active.signal.aborted) setError({ code: "NETWORK_ERROR", error: "Could not complete import. Retry the same review to recover safely." }); }
    finally { if (!active.signal.aborted) { setBusy(false); onBusy(false); } }
  }
  return <section aria-label="Import repository" className="space-y-3 rounded-lg border bg-muted/20 p-4">
    <h3 className="font-medium">Import {folder ? "this folder" : "repository"} into a new project</h3>
    <p className="text-xs text-muted-foreground">Up to 250 text files · 256 KiB per file · 2 MiB project. Import preserves the selected commit. Run code from the project when you are ready.</p>
    {created ? <div role="status" className="space-y-3"><p>Created {created.title}.</p><Button asChild><Link href={`/playground/${created.projectId}`}>Open imported project</Link></Button><Link href="/dashboard" className="ml-3 text-sm underline">View dashboard</Link></div> : <>
      <label className="block text-sm">New project name<input aria-label="New project name" maxLength={100} value={title} disabled={busy || !!review} onChange={event => setTitle(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      {review ? <div className="space-y-3">
        <p>{review.fileCount} files · {review.bytes.toLocaleString()} bytes · {review.template}</p>
        <p className="break-all text-xs text-muted-foreground">Source /{review.folder} · Commit {review.commitSha.slice(0, 12)}</p>
        {review.omitted.length > 0 && <>
          <p className="text-sm font-medium">{review.omitted.length} entries will be omitted</p>
          <ul aria-label="Omitted import entries" className="max-h-48 overflow-auto space-y-2 text-xs">{review.omitted.map(item => <li key={item.path}><span className="break-all font-mono">{item.path}</span> — {item.reason}</li>)}</ul>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />I accept these omissions; the project may need the missing assets to run.</label>
        </>}
        <div className="flex flex-wrap gap-2"><Button disabled={blocked || (review.omitted.length > 0 && !accepted)} onClick={() => void request("create")}>{busy ? "Importing…" : "Create imported project"}</Button><Button variant="outline" disabled={busy} onClick={() => { setReview(null); setError(null); }}>Change import review</Button></div>
      </div> : <Button disabled={blocked || !title.trim()} onClick={() => void request("review")}>{busy ? "Reviewing source…" : "Review import"}</Button>}
    </>}
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error.error}</p>{error.retryAt && <p>Retry after {new Date(error.retryAt).toLocaleTimeString()}.</p>}{["CONNECTION_REQUIRED", "CONNECTION_CHANGED", "CONNECTION_REVOKED", "NOT_CONFIGURED"].includes(error.code) && <Link href="/dashboard/github" className="underline">Manage GitHub connection</Link>}</div>}
  </section>;
}

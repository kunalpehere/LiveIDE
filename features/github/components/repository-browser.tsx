"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Folder, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepositoryImport } from "./repository-import";
import type { Branch, BrowseFailure, Directory, FilePreview, Page, Repository, TreeEntry } from "../types";

export function RepositoryBrowser() {
  const [repositories, setRepositories] = useState<Page<Repository> | null>(null);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [branches, setBranches] = useState<Page<Branch> | null>(null);
  const [branch, setBranch] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [parents, setParents] = useState<Directory[]>([]);
  const [file, setFile] = useState<FilePreview | null>(null);
  const [error, setError] = useState<BrowseFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const active = useRef<{ controller: AbortController; id: number } | null>(null);
  const sequence = useRef(0);
  const retry = useRef<{ params: Record<string, string | number>; accept: (data: unknown) => void } | null>(null);

  const load = useCallback(async <T,>(params: Record<string, string | number>, accept: (data: T) => void) => {
    active.current?.controller.abort();
    const controller = new AbortController(), id = ++sequence.current;
    active.current = { controller, id }; setLoading(true); setError(null);
    retry.current = { params, accept: data => accept(data as T) };
    try {
      const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
      const response = await fetch(`/api/github/browse?${query}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (active.current?.id !== id || controller.signal.aborted) return;
      if (!response.ok) {
        setError({ code: data.code ?? "BROWSE_UNAVAILABLE", error: data.error ?? "Could not load GitHub data. Please retry.", retryAt: data.retryAt });
        setNow(Date.now()); return;
      }
      accept(data);
    } catch {
      if (!controller.signal.aborted && active.current?.id === id) setError({ code: "NETWORK_ERROR", error: "Could not load GitHub data. Please retry." });
    } finally { if (active.current?.id === id && !controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    void load<Page<Repository>>({ action: "repositories", page: 1 }, setRepositories);
    return () => { active.current?.controller.abort(); active.current = null; };
  }, [load]);
  useEffect(() => {
    if (!error?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [error?.retryAt]);

  const blocked = loading || importBusy || !!(error?.retryAt && error.retryAt > now);
  function resetSource() { setBranch(""); setDirectory(null); setParents([]); setFile(null); }
  function loadRepositories(page: number) {
    setRepository(null); setBranches(null); resetSource();
    void load<Page<Repository>>({ action: "repositories", page }, setRepositories);
  }
  function chooseRepository(item: Repository) {
    setRepository(item); setBranches(null); resetSource();
    void load<Page<Branch>>({ action: "branches", owner: item.owner, repo: item.name, page: 1 }, setBranches);
  }
  function chooseBranch(name: string) {
    if (!repository || !name) return;
    setBranch(name); setDirectory(null); setParents([]); setFile(null);
    void load<Directory>({ action: "tree", owner: repository.owner, repo: repository.name, branch: name }, setDirectory);
  }
  function open(entry: TreeEntry) {
    if (!entry.cursor || !directory) return;
    setFile(null);
    if (entry.kind === "directory") {
      const nextParents = [...parents, directory]; setDirectory(null);
      void load<Directory>({ action: "directory", cursor: entry.cursor, page: 1 }, data => { setDirectory(data); setParents(nextParents); });
    } else void load<FilePreview>({ action: "file", cursor: entry.cursor }, setFile);
  }
  function goUp() {
    const parent = parents.at(-1); if (!parent) return;
    const remaining = parents.slice(0, -1); setFile(null); setDirectory(null);
    void load<Directory>({ action: "directory", cursor: parent.cursor, page: parent.page }, data => { setDirectory(data); setParents(remaining); });
  }
  function directoryPage(page: number) {
    if (!directory) return; setFile(null);
    void load<Directory>({ action: "directory", cursor: directory.cursor, page }, setDirectory);
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">GitHub repositories</h1><p className="mt-2 text-sm text-muted-foreground">Browse branches and preview source files from your connected account.</p></div>
      <Button asChild variant="outline"><Link href="/dashboard/github">Manage connection</Link></Button>
    </div>
    <p className="text-sm text-muted-foreground">Read-only previews · Text files up to 256 KiB</p>
    {error && <div role="alert" aria-label="Repository browsing error" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p>{error.error}</p>
      {error.retryAt && <p className="text-sm">Retry after {new Date(error.retryAt).toLocaleTimeString()}.</p>}
      {["CONNECTION_REQUIRED", "CONNECTION_REVOKED", "CONNECTION_CHANGED", "PRIVATE_ACCESS_REQUIRED", "NOT_CONFIGURED"].includes(error.code) && <Link href="/dashboard/github" className="mr-4 text-sm underline">Connect or reconnect GitHub</Link>}
      <Button variant="outline" disabled={blocked} onClick={() => { if (retry.current) void load(retry.current.params, retry.current.accept); }}>Retry</Button>
    </div>}
    <p role="status" className="text-sm text-muted-foreground">{loading ? "Loading GitHub data…" : ""}</p>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Repositories</h2>
        {repositories?.items.length === 0 && <p className="text-sm text-muted-foreground">No accessible repositories on this page. Check your connection permissions if repositories are missing.</p>}
        <ul className="space-y-2">{repositories?.items.map(item => <li key={item.id}>
          <button disabled={blocked} aria-pressed={repository?.id === item.id} onClick={() => chooseRepository(item)} className="w-full rounded-lg border p-3 text-left hover:bg-accent disabled:opacity-50 aria-pressed:border-primary">
            <span className="flex min-w-0 items-start gap-2"><Github className="mt-0.5 size-4 shrink-0" /><span className="break-all text-sm font-medium">{item.owner}/{item.name}</span></span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.private ? "Private" : "Public"}{item.defaultBranch ? ` · ${item.defaultBranch}` : ""}</span>
            {item.description && <span className="mt-2 block break-words text-xs text-muted-foreground">{item.description}</span>}
          </button>
        </li>)}</ul>
        {repositories && <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={blocked || repositories.page <= 1} onClick={() => loadRepositories(repositories.page - 1)}>Previous repositories</Button>
          <Button size="sm" variant="outline" disabled={blocked || !repositories.hasNext} onClick={() => loadRepositories(repositories.page + 1)}>Next repositories</Button>
        </div>}
        {repositories && <p className="text-xs text-muted-foreground">Repository page {repositories.page}</p>}
      </div>
      <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
        <h2 className="break-all font-semibold">{repository ? `${repository.owner}/${repository.name}` : "Source browser"}</h2>
        {!repository && <p className="text-sm text-muted-foreground">Choose a repository to browse its branches.</p>}
        {branches && branches.items.length === 0 && <p className="text-sm text-muted-foreground">This repository has no branches or source files yet.</p>}
        {branches && branches.items.length > 0 && <div className="space-y-3">
          <label className="block text-sm font-medium">Branch
            <select aria-label="Branch" value={branch} disabled={blocked} onChange={event => chooseBranch(event.target.value)} className="mt-2 block w-full rounded-md border bg-background p-2">
              <option value="">Choose a branch</option>
              {branch && !branches.items.some(item => item.name === branch) && <option value={branch}>{branch} (selected)</option>}
              {branches.items.map(item => <option key={item.name} value={item.name}>{item.name}{item.protected ? " (protected)" : ""}</option>)}
            </select>
          </label>
          {repository?.defaultBranch && repository.defaultBranch !== branch && <Button size="sm" variant="outline" disabled={blocked} onClick={() => chooseBranch(repository.defaultBranch!)}>Open default branch: {repository.defaultBranch}</Button>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={blocked || branches.page <= 1} onClick={() => { if (repository) void load<Page<Branch>>({ action: "branches", owner: repository.owner, repo: repository.name, page: branches.page - 1 }, setBranches); }}>Previous branches</Button>
            <Button size="sm" variant="outline" disabled={blocked || !branches.hasNext} onClick={() => { if (repository) void load<Page<Branch>>({ action: "branches", owner: repository.owner, repo: repository.name, page: branches.page + 1 }, setBranches); }}>Next branches</Button>
            <span className="text-xs text-muted-foreground">Branch page {branches.page}</span>
          </div>
        </div>}
        {directory && <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="break-all font-mono text-sm">/{directory.path}</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={blocked || parents.length === 0} onClick={goUp}>Up one folder</Button><Button size="sm" variant="outline" disabled={blocked} onClick={() => chooseBranch(branch)}>Refresh branch</Button></div>
          </div>
          <p className="text-xs text-muted-foreground">Pinned source tree {directory.treeSha.slice(0, 8)}. Refresh branch to see newer commits.</p>
          <RepositoryImport key={`${repository?.id}:${directory.path}:${directory.treeSha}`} cursor={directory.cursor} folder={directory.path} defaultTitle={`${repository?.name ?? "GitHub"}${directory.path ? `-${directory.path.split("/").at(-1)}` : ""}`} disabled={loading || !!(error?.retryAt && error.retryAt > now)} onBusy={setImportBusy} />
          {directory.items.length === 0 && <p className="text-sm text-muted-foreground">This folder is empty.</p>}
          <ul className="divide-y rounded-lg border">{directory.items.map(entry => <li key={entry.path} className="p-3">
            <button aria-label={`${entry.kind === "directory" ? "Open folder" : "Preview file"} ${entry.name}`} disabled={blocked || !entry.cursor} onClick={() => open(entry)} className="flex w-full items-center gap-2 text-left text-sm hover:underline disabled:opacity-50">{entry.kind === "directory" ? <Folder className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}<span className="break-all">{entry.name}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{entry.kind === "directory" ? "Folder" : entry.size === null ? "Unsupported" : `${entry.size} B`}</span></button>
            {entry.restriction && <p className="mt-1 text-xs text-muted-foreground">{entry.restriction}</p>}
          </li>)}</ul>
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={blocked || directory.page <= 1} onClick={() => directoryPage(directory.page - 1)}>Previous files</Button><Button size="sm" variant="outline" disabled={blocked || !directory.hasNext} onClick={() => directoryPage(directory.page + 1)}>Next files</Button><span className="text-xs text-muted-foreground">Folder page {directory.page}</span></div>
        </div>}
        {file && <div className="min-w-0 space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-all font-mono text-sm font-medium">{file.path}</h3><Button variant="ghost" size="sm" onClick={() => setFile(null)}>Close preview</Button></div>
          <p className="text-xs text-muted-foreground">{file.size} bytes · {file.branch} · Read only</p>
          <pre aria-label="File preview" tabIndex={0} className="max-h-[560px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5">{file.content || "(Empty file)"}</pre>
        </div>}
      </div>
    </div>
  </section>;
}

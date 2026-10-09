"use client";
import { useMemo } from "react";
import { lineDiff } from "../lib/line-diff";
export function FileDiff({ path, before, after }: { path: string; before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  return <div className="space-y-3">
    {lines ? <pre aria-label={`Diff ${path}`} className="mt-3 max-h-96 overflow-auto rounded border font-mono text-xs">{lines.map((line, index) => <span key={index} className={`block whitespace-pre px-3 ${line.kind === "added" ? "bg-green-500/15" : line.kind === "removed" ? "bg-red-500/15" : ""}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.text || " "}</span>)}</pre> : <p className="mt-3 text-xs text-muted-foreground">Large change: compare the complete before/after text below.</p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2"><div className="min-w-0"><p className="mb-1 text-xs">GitHub before</p><pre aria-label={`Before ${path}`} className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{before || "(Empty or absent)"}</pre></div><div className="min-w-0"><p className="mb-1 text-xs">Project after</p><pre aria-label={`After ${path}`} className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{after || "(Empty or deleted)"}</pre></div></div>
  </div>;
}

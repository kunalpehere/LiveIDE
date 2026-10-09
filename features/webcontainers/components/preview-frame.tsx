"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const PREVIEW_LOAD_TIMEOUT_MS = 20_000;

// A cross-origin iframe load confirms navigation, not application health.
export default function PreviewFrame({ url, onRestart }: { url: string; onRestart: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const currentAttempt = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const element = frame.current;
    const failed = () => { if (currentAttempt.current === attempt) setStatus("failed"); };
    element?.addEventListener("error", failed);
    const timeout = setTimeout(() => {
      if (currentAttempt.current === attempt) setStatus(current => current === "loading" ? "failed" : current);
    }, PREVIEW_LOAD_TIMEOUT_MS);
    return () => { clearTimeout(timeout); element?.removeEventListener("error", failed); };
  }, [attempt]);
  const reload = () => { currentAttempt.current += 1; setStatus("loading"); setAttempt(currentAttempt.current); };
  return <div className="min-h-0 flex-1 flex flex-col">
    <div className="flex items-center gap-3 border-b px-3 py-1 text-xs" aria-live="polite">
      <span>{status === "loading" ? "Loading preview…" : status === "failed" ? "Preview could not load" : "Preview frame loaded"}</span>
      <Button variant="ghost" size="sm" onClick={reload} aria-label="Reload preview">Reload</Button>
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open preview in new tab">Open in new tab</a>
    </div>
    {status === "failed" && <div role="alert" className="p-3 text-sm">
      The preview did not finish loading. Try reloading, opening it in a new tab, or restarting the runtime.
      <Button variant="outline" size="sm" onClick={onRestart} className="ml-2" aria-label="Restart runtime to recover preview">Restart runtime</Button>
    </div>}
    <iframe ref={frame} key={attempt} src={url} className="w-full min-h-0 flex-1 border-none bg-white" title="WebContainer Preview"
      onLoad={() => { if (currentAttempt.current === attempt) setStatus("loaded"); }} />
  </div>;
}

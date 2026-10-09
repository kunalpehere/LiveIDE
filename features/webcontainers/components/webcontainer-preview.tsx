"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { SpawnOptions, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { CheckCircle, Globe2, Loader2, RotateCcw, Square, XCircle } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { RuntimePhase, StartupMetrics } from "../service/webContainerService";
import PreviewFrame from "./preview-frame";
import RuntimePanelBoundary from "./runtime-panel-boundary";
import type { TerminalRef } from "./terminal";
const TerminalComponent = dynamic(() => import("./terminal"), { ssr: false });

interface WebContainerPreviewProps {
  canEdit?: boolean;
  projectId?: string;
  instance: WebContainer | null;
  phase: RuntimePhase;
  serverUrl: string | null;
  error: string | null;
  startup?: StartupMetrics | null;
  spawnProcess: (
    command: string,
    args?: string[],
    options?: SpawnOptions,
  ) => Promise<WebContainerProcess>;
  subscribeOutput: (listener: (data: string) => void) => () => void;
  onRetry: () => void;
  onStop: () => void;
}

const steps: Array<{ phase: RuntimePhase; label: string }> = [
  { phase: "booting", label: "Booting browser runtime" },
  { phase: "mounting", label: "Mounting project files" },
  { phase: "installing", label: "Installing dependencies" },
  { phase: "starting", label: "Starting development server" },
];

export default function WebContainerPreview(props: WebContainerPreviewProps) {
  return <RuntimePanelBoundary key={props.projectId}><RuntimePanel {...props} /></RuntimePanelBoundary>;
}

function RuntimePanel({
  instance,
  phase,
  serverUrl,
  error,
  startup,
  spawnProcess,
  subscribeOutput,
  onRetry,
  onStop,
  canEdit = true,
}: WebContainerPreviewProps) {
  const terminalRef = useRef<TerminalRef>(null);

  useEffect(
    () => subscribeOutput(data => terminalRef.current?.writeToTerminal(data)),
    [subscribeOutput],
  );

  const activeStep = steps.findIndex(step => step.phase === phase);
  const progress = phase === "ready" ? 100 : Math.max(0, ((activeStep + 1) / steps.length) * 100);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b bg-muted/20 px-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Globe2 className="size-3.5 text-muted-foreground" />
          Preview
          <span className={`size-1.5 rounded-full ${phase === "ready" ? "bg-emerald-500" : "bg-amber-500"}`} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onStop} disabled={!canEdit || ["idle", "stopped", "failed", "unsupported"].includes(phase)} aria-label="Stop runtime">
            <Square className="size-3.5" /> Stop
          </Button>
          <Button variant="ghost" size="sm" onClick={onRetry} aria-label="Restart runtime" disabled={!canEdit || phase !== "ready"}>
            <RotateCcw className="size-3.5" /> Restart
          </Button>
        </div>
      </div>
      {startup && <div className="border-b px-3 py-2 text-xs text-muted-foreground" aria-live="polite" data-testid="runtime-startup">
        {startup.kind === "cold" ? "Cold startup" : "Warm startup"}
        {startup.totalMs !== null && ` · ${(startup.totalMs / 1000).toFixed(2)}s total`}
        <div className="mt-1">
          {([ ["Mount", startup.mountMs], [startup.dependencies === "reused" ? "Dependencies reused" : "Install", startup.installMs],
            ["Server start", startup.serverMs] ] as const).map(([label, ms]) =>
            <span key={label} className="mr-3">{label}: {ms === null ? "pending" : `${(ms / 1000).toFixed(2)}s`}</span>)}
        </div>
      </div>}
      {!canEdit ? <div className="min-h-0 flex-1 p-6 text-sm">Viewer access: observe collaborators in Shared runtime. Local execution and terminal input are unavailable.</div> : phase === "failed" || phase === "unsupported" || error ? (
        <div role="alert" className="min-h-0 flex-1 overflow-auto p-6">
          <div className="flex items-center gap-2 mb-3"><XCircle className="size-5" />
            <h3 className="font-semibold">{phase === "unsupported" ? "Browser runtime unavailable" : "Runtime error"}</h3></div>
          <p className="text-sm">{error}</p>
          <p className="text-sm mt-2">Your files remain available for editing.</p>
          {phase !== "unsupported" && <Button className="mt-4" variant="outline" onClick={onRetry}>Retry runtime</Button>}
        </div>
      ) : phase === "stopped" ? (
        <div className="min-h-0 flex-1 flex flex-col items-center justify-center gap-3 p-3">
          <h3 className="font-semibold">Runtime stopped</h3>
          <p className="text-sm text-muted-foreground">Your files remain available for editing.</p>
          <Button variant="outline" onClick={onRetry}>Start runtime</Button>
        </div>
      ) : serverUrl && phase === "ready" ? (
        <PreviewFrame key={serverUrl} url={serverUrl} onRestart={onRetry} />
      ) : (
        <div className="min-h-0 flex-1 p-6">
          <Progress value={progress} className="mb-6 h-1" />
          <div className="space-y-3">
            {steps.map((step, index) => {
              const complete = phase === "ready" || index < activeStep;
              const active = index === activeStep;
              return (
                <div className="flex items-center gap-3" key={step.phase}>
                  {complete ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : active ? (
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                  )}
                  <span className={complete ? "text-green-600" : active ? "text-blue-600" : "text-gray-500"}>
                    {step.phase === "installing" && startup?.dependencies === "reused" ? "Reusing installed dependencies" : step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {canEdit && <div className="h-56 shrink-0 border-t">
        <TerminalComponent
          ref={terminalRef}
          webContainerInstance={instance}
          runtimeReady={phase === "ready"}
          spawnProcess={spawnProcess}
          theme="dark"
          className="h-full"
        />
      </div>}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { SpawnOptions, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { CheckCircle, ExternalLink, Globe2, Loader2, RotateCcw, XCircle } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { RuntimePhase } from "../service/webContainerService";
import TerminalComponent, { type TerminalRef } from "./terminal";

interface WebContainerPreviewProps {
  instance: WebContainer | null;
  phase: RuntimePhase;
  serverUrl: string | null;
  error: string | null;
  spawnProcess: (
    command: string,
    args?: string[],
    options?: SpawnOptions,
  ) => Promise<WebContainerProcess>;
  subscribeOutput: (listener: (data: string) => void) => () => void;
  onRetry: () => void;
}

const steps: Array<{ phase: RuntimePhase; label: string }> = [
  { phase: "booting", label: "Booting browser runtime" },
  { phase: "mounting", label: "Mounting project files" },
  { phase: "installing", label: "Installing dependencies" },
  { phase: "starting", label: "Starting development server" },
];

export default function WebContainerPreview({
  instance,
  phase,
  serverUrl,
  error,
  spawnProcess,
  subscribeOutput,
  onRetry,
}: WebContainerPreviewProps) {
  const terminalRef = useRef<TerminalRef>(null);

  useEffect(
    () => subscribeOutput(data => terminalRef.current?.writeToTerminal(data)),
    [subscribeOutput],
  );

  if (phase === "error" || error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5" />
            <h3 className="font-semibold">Runtime error</h3>
          </div>
          <p className="text-sm">{error}</p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            Retry runtime
          </Button>
        </div>
      </div>
    );
  }

  const activeStep = steps.findIndex(step => step.phase === phase);
  const progress = phase === "running" ? 100 : Math.max(0, ((activeStep + 1) / steps.length) * 100);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b bg-muted/20 px-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Globe2 className="size-3.5 text-muted-foreground" />
          Preview
          <span className={`size-1.5 rounded-full ${phase === "running" ? "bg-emerald-500" : "bg-amber-500"}`} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={onRetry} aria-label="Restart runtime">
            <RotateCcw className="size-3.5" />
          </Button>
          {serverUrl && (
            <Button asChild variant="ghost" size="icon" className="size-7">
              <a href={serverUrl} target="_blank" rel="noreferrer" aria-label="Open preview in new tab"><ExternalLink className="size-3.5" /></a>
            </Button>
          )}
        </div>
      </div>
      {serverUrl && phase === "running" ? (
        <div className="min-h-0 flex-1 bg-white">
          <iframe src={serverUrl} className="w-full h-full border-none" title="WebContainer Preview" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-6">
          <Progress value={progress} className="mb-6 h-1" />
          <div className="space-y-3">
            {steps.map((step, index) => {
              const complete = phase === "running" || index < activeStep;
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
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={serverUrl ? "h-56 shrink-0 border-t" : "min-h-56 flex-1 border-t"}>
        <TerminalComponent
          ref={terminalRef}
          webContainerInstance={instance}
          spawnProcess={spawnProcess}
          theme="dark"
          className="h-full"
        />
      </div>
    </div>
  );
}

"use client";

import { AlertTriangle, Circle, GitBranch, LockKeyhole, Radio, Users } from "lucide-react";
import type { RuntimePhase } from "@/features/webcontainers/service/webContainerService";

interface StatusBarProps {
  isConnected: boolean;
  hasUnsavedChanges: boolean;
  activeFile?: string;
  language?: string;
  accessRole?: string;
  collaborationEnabled?: boolean;
  runtimePhase?: RuntimePhase;
}

export function StatusBar({
  isConnected,
  hasUnsavedChanges,
  activeFile,
  language = "plaintext",
  accessRole = "VIEWER",
  collaborationEnabled = false,
  runtimePhase = "idle",
}: StatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t bg-muted/40 px-2 font-mono text-[10px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3" /> main
        </span>
        <span className="inline-flex items-center gap-1">
          <Circle className={`size-2 fill-current ${isConnected ? "text-emerald-500" : runtimePhase === "error" ? "text-destructive" : "text-amber-500"}`} />
          runtime: {runtimePhase}
        </span>
        {collaborationEnabled && (
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Radio className="size-3" /> collaboration enabled
          </span>
        )}
        {hasUnsavedChanges && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3" /> unsaved
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden items-center gap-1 md:inline-flex">
          {accessRole === "OWNER" ? <Users className="size-3" /> : <LockKeyhole className="size-3" />}
          {accessRole.toLowerCase()}
        </span>
        {activeFile && <span className="hidden max-w-36 truncate sm:inline">{activeFile}</span>}
        <span>{language.toUpperCase()}</span>
        <span className="hidden sm:inline">UTF-8</span>
      </div>
    </div>
  );
}

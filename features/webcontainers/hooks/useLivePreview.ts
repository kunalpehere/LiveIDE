import { useCallback, useEffect, useRef, useState } from "react";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import type { TemplateFolder } from "@/features/playground/libs/path-to-json";
import { transformToWebContainerFormat } from "./transformer";
import { isDependencyInput, projectFiles } from "../service/dependency-inputs";
import type { RuntimePhase } from "../service/webContainerService";

export const LIVE_PREVIEW_DELAY_MS = 500;

// Resolve drafts by their path IDs, including files with identical basenames.
export function draftTemplate(template: TemplateFolder, projectId: string): TemplateFolder {
  const state = useFileExplorer.getState();
  const drafts = new Map(state.playgroundId === projectId ? state.openFiles.map(file => [file.id, file.content]) : []);
  const visit = (folder: TemplateFolder, prefix = ""): TemplateFolder => ({ ...folder,
    items: folder.items.map(item => {
      if ("folderName" in item) return visit(item, prefix + item.folderName + "/");
      const path = prefix + item.filename + (item.fileExtension ? "." + item.fileExtension : "");
      return { ...item, content: drafts.get(path) ?? item.content };
    }),
  });
  return visit(template);
}

export function useLivePreview({ projectId, template, phase, enabled, canEdit, writeFile, restart }: {
  projectId: string; template: TemplateFolder | null; phase: RuntimePhase; enabled: boolean; canEdit: boolean;
  writeFile: (path: string, content: string) => Promise<void>;
  restart: (template: TemplateFolder) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "synced" | "error">("idle");
  const applied = useRef(new Map<string, string>());
  const generation = useRef(0);
  const mountedDraft = useRef<TemplateFolder | null>(null);
  const baselineRun = useRef<{projectId: string; phase: RuntimePhase} | null>(null);
  useEffect(() => { mountedDraft.current = null; }, [projectId, template]);
  useEffect(() => {
    // Saving one file changes the template reference but does not remount a
    // ready runtime. Keep knowledge of other already-previewed drafts.
    if (baselineRun.current?.projectId === projectId && baselineRun.current.phase === phase) return;
    baselineRun.current = {projectId, phase};
    const baseline = mountedDraft.current ?? template;
    applied.current = baseline ? projectFiles(transformToWebContainerFormat(baseline)) : new Map();
    generation.current += 1;
  }, [projectId, template, phase]);

  const sync = useCallback(async () => {
    if (!template || phase !== "ready" || !canEdit) return;
    const token = generation.current;
    const files = projectFiles(transformToWebContainerFormat(draftTemplate(template, projectId)));
    for (const [path, content] of files) {
      if (token !== generation.current) return;
      // Dependency/config edits require an explicit Save or Run/Restart.
      if (isDependencyInput(path) || applied.current.get(path) === content) continue;
      await writeFile(path, content);
      if (token !== generation.current) return;
      applied.current.set(path, content);
    }
  }, [template, phase, canEdit, projectId, writeFile]);

  useEffect(() => {
    if (!enabled || !canEdit || phase !== "ready" || !template) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (useFileExplorer.getState().playgroundId !== projectId) return;
      clearTimeout(timer);
      setStatus("pending");
      timer = setTimeout(() => {
        void sync().then(() => { if (active) setStatus("synced"); }, () => { if (active) setStatus("error"); });
      }, LIVE_PREVIEW_DELAY_MS);
    };
    const unsubscribe = useFileExplorer.subscribe(schedule);
    schedule();
    return () => { active = false; clearTimeout(timer); unsubscribe(); generation.current += 1; };
  }, [enabled, canEdit, phase, template, projectId, sync]);

  const run = useCallback(async (forceRestart = false) => {
    if (!template) return;
    const snapshot = canEdit ? draftTemplate(template, projectId) : template;
    const saved = projectFiles(transformToWebContainerFormat(template));
    const files = projectFiles(transformToWebContainerFormat(snapshot));
    const dependenciesChanged = [...files].some(([path, content]) => isDependencyInput(path) && saved.get(path) !== content);
    if (forceRestart || phase !== "ready" || dependenciesChanged) {
      mountedDraft.current = snapshot;
      await restart(snapshot);
    }
    else { await sync(); setStatus("synced"); }
  }, [template, canEdit, projectId, phase, restart, sync]);
  return { run, status: enabled && phase === "ready" ? status : "idle" };
}

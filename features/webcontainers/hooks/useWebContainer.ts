import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { SpawnOptions } from "@webcontainer/api";

import type { TemplateFolder } from "@/features/playground/libs/path-to-json";
import { transformToWebContainerFormat } from "./transformer";
import webContainerService from "../service/webContainerService";

interface UseWebContainerProps {
  projectId: string;
  templateData: TemplateFolder | null;
  canEdit?: boolean;
}

export const useWebContainer = ({ projectId, templateData, canEdit = true }: UseWebContainerProps) => {
  const runtime = useSyncExternalStore(webContainerService.subscribe,
    webContainerService.getState, webContainerService.getServerSnapshot);

  useEffect(() => {
    if (!canEdit) return;
    const activeProject = webContainerService.getState().projectId;
    if (activeProject && activeProject !== projectId) webContainerService.teardown();
    void webContainerService.acquire().catch(() => undefined);

    return () => {
      webContainerService.release();
    };
  }, [projectId, canEdit]);

  useEffect(() => {
    if (!templateData || !canEdit) return;
    const files = transformToWebContainerFormat(templateData);
    void webContainerService.setup(projectId, files).catch(() => undefined);
  }, [projectId, templateData, canEdit]);

  const writeFileSync = useCallback(
    (filePath: string, content: string) => { if (!canEdit) return Promise.reject(new Error("Viewers cannot modify the runtime")); return webContainerService.writeFile(filePath, content, projectId); },
    [projectId, canEdit],
  );

  const spawnProcess = useCallback(
    (command: string, args: string[] = [], options?: SpawnOptions) =>
      canEdit ? webContainerService.spawn(command, args, options, projectId) : Promise.reject(new Error("Viewers cannot use the runtime terminal")),
    [projectId, canEdit],
  );

  const stop = useCallback(() => { if (canEdit) webContainerService.stop(projectId); }, [projectId, canEdit]);

  const restart = useCallback(
    (nextTemplateData: TemplateFolder = templateData!, options: { onlyIfActive?: boolean } = {}) => {
      if (!canEdit) return Promise.reject(new Error("Viewers cannot start the runtime"));
      if (!nextTemplateData) return Promise.resolve();
      const snapshot = webContainerService.getState();
      const active = ["booting", "mounting", "installing", "starting", "ready"].includes(snapshot.phase);
      if (snapshot.projectId !== projectId || (options.onlyIfActive && !active)) return Promise.resolve();
      return webContainerService.setup(
        projectId,
        transformToWebContainerFormat(nextTemplateData),
        true,
      );
    },
    [projectId, templateData, canEdit],
  );

  return {
    instance: canEdit ? runtime.instance : null,
    serverUrl: canEdit ? runtime.serverUrl : null,
    phase: canEdit ? runtime.phase : "idle" as const,
    startup: runtime.startup,
    isLoading: ["idle", "booting", "mounting", "installing", "starting"].includes(runtime.phase),
    error: runtime.error,
    writeFileSync,
    restart,
    stop,
    spawnProcess,
    subscribeOutput: webContainerService.subscribeOutput,
  };
};

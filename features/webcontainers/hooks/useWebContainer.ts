import { useCallback, useEffect, useState } from "react";
import type { SpawnOptions, WebContainer } from "@webcontainer/api";

import type { TemplateFolder } from "@/features/playground/libs/path-to-json";
import { transformToWebContainerFormat } from "./transformer";
import webContainerService, {
  type RuntimeState,
} from "../service/webContainerService";

interface UseWebContainerProps {
  projectId: string;
  templateData: TemplateFolder | null;
}

export const useWebContainer = ({ projectId, templateData }: UseWebContainerProps) => {
  const [instance, setInstance] = useState<WebContainer | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>(webContainerService.getState());

  useEffect(() => webContainerService.subscribe(setRuntime), []);

  useEffect(() => {
    let active = true;
    void webContainerService.acquire()
      .then(container => {
        if (active) setInstance(container);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      webContainerService.release();
    };
  }, []);

  useEffect(() => {
    if (!instance || !templateData) return;
    const files = transformToWebContainerFormat(templateData);
    void webContainerService.setup(projectId, files).catch(() => undefined);
  }, [instance, projectId, templateData]);

  const writeFileSync = useCallback(
    (filePath: string, content: string) => webContainerService.writeFile(filePath, content),
    [],
  );

  const spawnProcess = useCallback(
    (command: string, args: string[] = [], options?: SpawnOptions) =>
      webContainerService.spawn(command, args, options),
    [],
  );

  const restart = useCallback(
    (nextTemplateData: TemplateFolder = templateData!) => {
      if (!nextTemplateData) return Promise.resolve();
      return webContainerService.setup(
        projectId,
        transformToWebContainerFormat(nextTemplateData),
        true,
      );
    },
    [projectId, templateData],
  );

  return {
    instance,
    serverUrl: runtime.serverUrl,
    phase: runtime.phase,
    isLoading: ["idle", "booting", "mounting", "installing", "starting"].includes(runtime.phase),
    error: runtime.error,
    writeFileSync,
    restart,
    spawnProcess,
    subscribeOutput: webContainerService.subscribeOutput,
  };
};

import type { FileSystemTree, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebContainerSessionService } from "@/features/webcontainers/service/webContainerService";

const files: FileSystemTree = {
  "package.json": { file: { contents: '{"scripts":{"start":"vite"}}' } },
};

function processWithExit(exit: Promise<number>) {
  return {
    exit,
    kill: vi.fn(),
    output: new ReadableStream<string>({ start: controller => controller.close() }),
  } as unknown as WebContainerProcess;
}

function runtimeFixture() {
  let serverReady: ((port: number, url: string) => void) | undefined;
  const unsubscribe = vi.fn();
  const install = processWithExit(Promise.resolve(0));
  const server = processWithExit(new Promise<number>(() => undefined));
  const instance = {
    mount: vi.fn().mockResolvedValue(undefined),
    spawn: vi.fn()
      .mockResolvedValueOnce(install)
      .mockImplementationOnce(async () => {
        queueMicrotask(() => serverReady?.(5173, "http://localhost:5173"));
        return server;
      }),
    on: vi.fn((_event: string, listener: (port: number, url: string) => void) => {
      serverReady = listener;
      return unsubscribe;
    }),
    teardown: vi.fn(),
    fs: { mkdir: vi.fn(), writeFile: vi.fn() },
  } as unknown as WebContainer;

  return { instance, install, server, unsubscribe };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WebContainerSessionService", () => {
  it("boots only once for concurrent consumers", async () => {
    const fixture = runtimeFixture();
    const boot = vi.fn().mockResolvedValue(fixture.instance);
    const service = new WebContainerSessionService(boot);

    const [first, second] = await Promise.all([service.acquire(), service.acquire()]);

    expect(first).toBe(fixture.instance);
    expect(second).toBe(fixture.instance);
    expect(boot).toHaveBeenCalledOnce();
    service.teardown();
  });

  it("keeps the runtime during a React Strict Mode remount", async () => {
    vi.useFakeTimers();
    const fixture = runtimeFixture();
    const boot = vi.fn().mockResolvedValue(fixture.instance);
    const service = new WebContainerSessionService(boot);

    await service.acquire();
    service.release();
    await service.acquire();
    await vi.advanceTimersByTimeAsync(250);

    expect(fixture.instance.teardown).not.toHaveBeenCalled();
    expect(boot).toHaveBeenCalledOnce();
    service.teardown();
  });

  it("mounts, installs, starts, and deduplicates setup for one project", async () => {
    const fixture = runtimeFixture();
    const service = new WebContainerSessionService(() => Promise.resolve(fixture.instance));

    await service.setup("project-1", files);
    await service.setup("project-1", files);

    expect(fixture.instance.mount).toHaveBeenCalledOnce();
    expect(fixture.instance.spawn).toHaveBeenNthCalledWith(1, "npm", ["install"], undefined);
    expect(fixture.instance.spawn).toHaveBeenNthCalledWith(2, "npm", ["run", "start"], undefined);
    expect(service.getState()).toEqual({
      phase: "running",
      serverUrl: "http://localhost:5173",
      error: null,
    });

    service.teardown();
    expect(fixture.server.kill).toHaveBeenCalledOnce();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.instance.teardown).toHaveBeenCalledOnce();
  });
});

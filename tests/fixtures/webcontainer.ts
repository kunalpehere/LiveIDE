import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import { vi } from "vitest";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flushRuntime() {
  for (let index = 0; index < 60; index++) await Promise.resolve();
}
export function processFixture(exit = deferred<number>().promise) {
  const cancelOutput = vi.fn();
  const process = {
    exit, kill: vi.fn(),
    output: new ReadableStream<string>({ cancel: cancelOutput }),
  } as unknown as WebContainerProcess;
  return { process, cancelOutput };
}
export function runtimeFixture(settings: {
  autoReady?: boolean;
  installExits?: Promise<number>[];
  serverExits?: Promise<number>[];
} = {}) {
  const listeners = new Set<(port: number, url: string) => void>();
  const callbacks: Array<(port: number, url: string) => void> = [];
  const errors = new Set<(event: { message: string }) => void>();
  const installs: ReturnType<typeof processFixture>[] = [];
  const servers: ReturnType<typeof processFixture>[] = [];
  const commands: ReturnType<typeof processFixture>[] = [];
  const emitReady = (url = "http://localhost:5173") => {
    for (const listener of listeners) listener(5173, url);
  };
  const instance = {
    mount: vi.fn().mockResolvedValue(undefined),
    spawn: vi.fn(async (_command: string, args: string[] = []) => {
      if (args[0] === "install") {
        const fixture = processFixture(settings.installExits?.shift() ?? Promise.resolve(0));
        installs.push(fixture);
        return fixture.process;
      }
      if (args[0] === "run") {
        const fixture = processFixture(settings.serverExits?.shift());
        servers.push(fixture);
        if (settings.autoReady !== false) queueMicrotask(() => emitReady());
        return fixture.process;
      }
      const fixture = processFixture();
      commands.push(fixture);
      return fixture.process;
    }),
    on: vi.fn((_event: string, listener: (port: number, url: string) => void) => {
      if (_event === "error") {
        const errorListener = listener as unknown as (event: { message: string }) => void;
        errors.add(errorListener);
        return () => errors.delete(errorListener);
      }
      listeners.add(listener); callbacks.push(listener);
      return () => listeners.delete(listener);
    }),
    teardown: vi.fn(),
    fs: { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined), rm: vi.fn().mockResolvedValue(undefined) },
  } as unknown as WebContainer;
  const emitError = (message: string) => { for (const listener of errors) listener({ message }); };
  return { instance, listeners, errors, callbacks, installs, servers, commands, emitReady, emitError };
}

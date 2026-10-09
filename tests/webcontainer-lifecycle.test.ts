import type { FileSystemTree } from "@webcontainer/api";
import { afterEach, expect, it, vi } from "vitest";
import { WebContainerSessionService } from "@/features/webcontainers/service/webContainerService";
import { UnsupportedRuntimeError } from "@/features/webcontainers/service/browser-support";
import { deferred, flushRuntime, processFixture, runtimeFixture } from "./fixtures/webcontainer";

const files: FileSystemTree = { "package.json": { file: { contents: "{}" } } };
const services: WebContainerSessionService[] = [];
function serviceFor(...args: ConstructorParameters<typeof WebContainerSessionService>) {
  const service = new WebContainerSessionService(...args);
  services.push(service);
  return service;
}
afterEach(() => { services.splice(0).forEach(service => service.teardown()); vi.useRealTimers(); });

it("shares pending setup and follows the complete lifecycle", async () => {
  const runtime = runtimeFixture();
  const boot = vi.fn().mockResolvedValue(runtime.instance);
  const service = serviceFor(boot);
  const phases: string[] = [];
  service.subscribe(() => phases.push(service.getState().phase));
  const first = service.setup("a", files);
  expect(service.setup("a", files)).toBe(first);
  await first;
  await service.setup("a", files);
  expect(boot).toHaveBeenCalledOnce();
  expect(runtime.instance.mount).toHaveBeenCalledOnce();
  expect(phases).toEqual(expect.arrayContaining(["booting", "mounting", "installing", "starting", "ready"]));
});

it("recovers boot failure and exposes the successful instance", async () => {
  const runtime = runtimeFixture();
  const boot = vi.fn().mockRejectedValueOnce(new Error("boot failed")).mockResolvedValue(runtime.instance);
  const service = serviceFor(boot);
  await expect(service.setup("a", files)).rejects.toThrow("boot failed");
  expect(service.getState()).toMatchObject({ phase: "failed", instance: null });
  await service.restart();
  expect(service.getState()).toMatchObject({ phase: "ready", instance: runtime.instance });
  expect(boot).toHaveBeenCalledTimes(2);
});

it("preserves unsupported browser errors instead of turning them into generic failures", async () => {
  const service = serviceFor(async () => { throw new UnsupportedRuntimeError("Isolation unavailable"); });
  await expect(service.setup("a", files)).rejects.toThrow("Isolation unavailable");
  expect(service.getState().phase).toBe("unsupported");
});

it("retries an installation failure using the active container", async () => {
  const runtime = runtimeFixture({ installExits: [Promise.resolve(1), Promise.resolve(0)] });
  const boot = vi.fn().mockResolvedValue(runtime.instance);
  const service = serviceFor(boot);
  await expect(service.setup("a", files)).rejects.toThrow("exit code 1");
  expect(service.getState().phase).toBe("failed");
  await service.restart();
  expect(service.getState().phase).toBe("ready");
  expect(boot).toHaveBeenCalledOnce();
  expect(runtime.installs).toHaveLength(2);
});

it("times out a hung installation, kills it, and permits retry", async () => {
  vi.useFakeTimers();
  const runtime = runtimeFixture({ installExits: [deferred<number>().promise, Promise.resolve(0)] });
  const service = serviceFor(async () => runtime.instance, { installTimeoutMs: 10 });
  const failed = expect(service.setup("a", files)).rejects.toThrow("installation timed out");
  await flushRuntime();
  expect(service.getState().phase).toBe("installing");
  await vi.advanceTimersByTimeAsync(11);
  await failed;
  expect(runtime.installs[0].process.kill).toHaveBeenCalledOnce();
  await service.restart();
  expect(service.getState().phase).toBe("ready");
});

it("stops installation promptly, cancels output, and ignores late failure", async () => {
  const oldExit = deferred<number>();
  const runtime = runtimeFixture({ installExits: [oldExit.promise] });
  const service = serviceFor(async () => runtime.instance);
  const cancelled = expect(service.setup("a", files)).rejects.toThrow("cancelled");
  await flushRuntime();
  service.stop();
  await cancelled;
  await flushRuntime();
  expect(runtime.installs[0].process.kill).toHaveBeenCalledOnce();
  expect(runtime.installs[0].cancelOutput).not.toHaveBeenCalled();
  expect(runtime.installs[0].process.output.locked).toBe(false);
  expect(service.getState()).toMatchObject({ phase: "stopped", serverUrl: null, error: null });
  oldExit.resolve(1);
  await service.restart();
  expect(service.getState().phase).toBe("ready");
});

it("reports early server exit without waiting for the readiness timeout and retries", async () => {
  const settings = { autoReady: false, serverExits: [Promise.resolve(2)] };
  const runtime = runtimeFixture(settings);
  const service = serviceFor(async () => runtime.instance);
  await expect(service.setup("a", files)).rejects.toThrow("before becoming ready");
  expect(runtime.listeners.size).toBe(0);
  settings.autoReady = true;
  await service.restart();
  expect(service.getState().phase).toBe("ready");
});

it("times out readiness and ignores the cancelled server's late ready callback", async () => {
  vi.useFakeTimers();
  const settings = { autoReady: false };
  const runtime = runtimeFixture(settings);
  const service = serviceFor(async () => runtime.instance, { serverReadyTimeoutMs: 10 });
  const failed = expect(service.setup("a", files)).rejects.toThrow("did not become ready");
  await flushRuntime();
  const staleReady = runtime.callbacks[0];
  await vi.advanceTimersByTimeAsync(11);
  await failed;
  expect(runtime.servers[0].process.kill).toHaveBeenCalledOnce();
  expect(runtime.listeners.size).toBe(0);
  settings.autoReady = true;
  await service.restart();
  staleReady(9999, "http://stale.example");
  expect(service.getState()).toMatchObject({ phase: "ready", serverUrl: "http://localhost:5173" });
});

it.each([0, 3])("tracks server exit %i after readiness and can restart", async code => {
  const exit = deferred<number>();
  const runtime = runtimeFixture({ serverExits: [exit.promise] });
  const service = serviceFor(async () => runtime.instance);
  await service.setup("a", files);
  exit.resolve(code);
  await flushRuntime();
  expect(service.getState()).toMatchObject({ phase: code === 0 ? "stopped" : "failed", serverUrl: null });
  await service.restart();
  expect(service.getState().phase).toBe("ready");
});

it("retires a cancelled mount and isolates the next project from late completion", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  const mount = deferred<void>();
  vi.mocked(first.instance.mount).mockReturnValue(mount.promise);
  const service = serviceFor(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  const cancelled = expect(service.setup("a", files)).rejects.toThrow("cancelled");
  await flushRuntime();
  expect(service.getState().phase).toBe("mounting");
  await service.setup("b", files);
  await cancelled;
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  mount.resolve();
  await flushRuntime();
  expect(first.instance.spawn).not.toHaveBeenCalled();
  expect(service.getState()).toMatchObject({ projectId: "b", phase: "ready", instance: second.instance });
});

it("kills a process that arrives after its spawn was cancelled", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  const spawn = deferred<ReturnType<typeof processFixture>["process"]>();
  vi.mocked(first.instance.spawn).mockReturnValueOnce(spawn.promise);
  const service = serviceFor(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  const cancelled = expect(service.setup("a", files)).rejects.toThrow("cancelled");
  await flushRuntime();
  await service.restart();
  const lateProcess = processFixture();
  spawn.resolve(lateProcess.process);
  await cancelled;
  await flushRuntime();
  expect(lateProcess.process.kill).toHaveBeenCalledOnce();
  expect(service.getState()).toMatchObject({ phase: "ready", instance: second.instance });
});

it("waits for a cancelled boot to be disposed before booting its replacement", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  const pendingBoot = deferred<typeof first.instance>();
  const boot = vi.fn().mockReturnValueOnce(pendingBoot.promise).mockResolvedValue(second.instance);
  const service = serviceFor(boot);
  const cancelled = expect(service.setup("a", files)).rejects.toThrow("cancelled");
  await flushRuntime();
  service.teardown();
  const replacement = service.setup("b", files);
  await flushRuntime();
  expect(boot).toHaveBeenCalledOnce();
  pendingBoot.resolve(first.instance);
  await cancelled;
  await replacement;
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  expect(boot).toHaveBeenCalledTimes(2);
  expect(service.getState()).toMatchObject({ phase: "ready", instance: second.instance });
});

it("keeps stopped execution stopped on saves, retains new restart files, and guards old project commands", async () => {
  const runtime = runtimeFixture();
  const service = serviceFor(async () => runtime.instance);
  await service.setup("a", files);
  const command = await service.spawn("node", ["main.js"]);
  service.stop();
  expect(command.kill).toHaveBeenCalledOnce();
  const updated: FileSystemTree = { "main.js": { file: { contents: "new content" } } };
  await service.setup("a", updated);
  await service.writeFile("main.js", "saved while stopped", "a");
  expect(runtime.instance.fs.writeFile).not.toHaveBeenCalled();
  expect(service.getState().phase).toBe("stopped");
  await expect(service.spawn("node", [], undefined, "other-project")).rejects.toThrow("not ready");
  await service.restart();
  expect(runtime.instance.mount).toHaveBeenLastCalledWith(updated);
  expect(service.getState().phase).toBe("ready");
});

it("retires a failed mount and retries with a fresh filesystem", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  vi.mocked(first.instance.mount).mockRejectedValueOnce(new Error("Mount failed"));
  const service = serviceFor(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  await expect(service.setup("a", files)).rejects.toThrow("Mount failed");
  expect(service.getState()).toMatchObject({ phase: "failed", instance: null });
  await service.restart();
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  expect(service.getState()).toMatchObject({ phase: "ready", instance: second.instance });
});

it("recovers a process launch exception without refreshing", async () => {
  const runtime = runtimeFixture();
  vi.mocked(runtime.instance.spawn).mockRejectedValueOnce(new Error("Spawn failed"));
  const service = serviceFor(async () => runtime.instance);
  await expect(service.setup("a", files)).rejects.toThrow("Spawn failed");
  expect(service.getState().phase).toBe("failed");
  await service.restart();
  expect(service.getState().phase).toBe("ready");
});

it("retires a broken SDK container, removes its listeners, and retries", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  const service = serviceFor(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  await service.setup("a", files);
  first.emitError("Runtime transport failed");
  expect(service.getState()).toMatchObject({ phase: "failed", instance: null, serverUrl: null, error: "Runtime transport failed" });
  expect(first.errors.size).toBe(0);
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  await service.restart();
  expect(service.getState()).toMatchObject({ phase: "ready", instance: second.instance });
});

it("cancels concurrent terminal spawns and kills processes returned after Stop", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  const service = serviceFor(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  await service.setup("a", files);
  const one = deferred<ReturnType<typeof processFixture>["process"]>();
  const two = deferred<ReturnType<typeof processFixture>["process"]>();
  vi.mocked(first.instance.spawn).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const firstCommand = service.spawn("node", []);
  const secondCommand = service.spawn("node", []);
  const firstProcess = processFixture();
  const secondProcess = processFixture();
  const cancelled = expect(secondCommand).rejects.toThrow("cancelled");
  one.resolve(firstProcess.process);
  await firstCommand;
  service.stop();
  await cancelled;
  await service.restart();
  two.resolve(secondProcess.process);
  await flushRuntime();
  expect(firstProcess.process.kill).toHaveBeenCalledOnce();
  expect(secondProcess.process.kill).toHaveBeenCalledOnce();
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  expect(service.getState()).toMatchObject({ phase: "ready", instance: second.instance });
});

it("unblocks a durable save when its runtime filesystem write is cancelled", async () => {
  const runtime = runtimeFixture();
  const service = serviceFor(async () => runtime.instance);
  await service.setup("a", files);
  const mkdir = deferred<string>();
  vi.mocked(runtime.instance.fs.mkdir).mockReturnValueOnce(mkdir.promise);
  const saving = service.writeFile("src/main.js", "draft");
  await flushRuntime();
  service.stop();
  await saving;
  mkdir.resolve("src");
  await flushRuntime();
  expect(runtime.instance.fs.writeFile).not.toHaveBeenCalled();
  expect(runtime.instance.teardown).toHaveBeenCalledOnce();
  expect(service.getState().phase).toBe("stopped");
});

it("keeps Stop authoritative when an uninterruptible boot finishes later", async () => {
  const runtime = runtimeFixture();
  const pendingBoot = deferred<typeof runtime.instance>();
  const boot = vi.fn().mockReturnValue(pendingBoot.promise);
  const service = serviceFor(boot);
  const cancelled = expect(service.setup("a", files)).rejects.toThrow("cancelled");
  await flushRuntime();
  service.stop();
  await cancelled;
  pendingBoot.resolve(runtime.instance);
  await flushRuntime();
  expect(service.getState()).toMatchObject({ phase: "stopped", instance: runtime.instance, serverUrl: null });
  expect(runtime.instance.mount).not.toHaveBeenCalled();
  await service.restart();
  expect(service.getState().phase).toBe("ready");
  expect(boot).toHaveBeenCalledOnce();
});

it("applies source saves made during installation before exposing a ready preview", async () => {
  const install = deferred<number>();
  const runtime = runtimeFixture({ installExits: [install.promise] });
  const service = serviceFor(async () => runtime.instance);
  const starting = service.setup("a", files);
  await flushRuntime();
  expect(service.getState().phase).toBe("installing");
  await service.writeFile("src/main.js", "first saved draft");
  await service.writeFile("src/main.js", "latest saved draft");
  expect(runtime.instance.fs.writeFile).not.toHaveBeenCalled();
  install.resolve(0);
  await starting;
  expect(runtime.instance.fs.writeFile).toHaveBeenCalledWith("src/main.js", "latest saved draft");
  expect(runtime.installs).toHaveLength(1);
  expect(service.getState().phase).toBe("ready");
});

it("does not lose a save to the mount that was already in progress", async () => {
  const mount = deferred<void>();
  const runtime = runtimeFixture();
  vi.mocked(runtime.instance.mount).mockReturnValueOnce(mount.promise);
  const service = serviceFor(async () => runtime.instance);
  const starting = service.setup("a", files);
  await flushRuntime();
  await service.writeFile("main.js", "saved during mount");
  expect(runtime.instance.fs.writeFile).not.toHaveBeenCalled();
  mount.resolve();
  await starting;
  expect(runtime.instance.fs.writeFile).toHaveBeenCalledWith("main.js", "saved during mount");
  expect(service.getState().phase).toBe("ready");
});

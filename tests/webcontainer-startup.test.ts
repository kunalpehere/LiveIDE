import type { FileSystemTree, SpawnOptions, WebContainerProcess } from "@webcontainer/api";
import { afterEach, expect, it, vi } from "vitest";
import { WebContainerSessionService } from "@/features/webcontainers/service/webContainerService";
import { dependencySignature, projectFiles } from "@/features/webcontainers/service/dependency-inputs";
import { deferred, flushRuntime, runtimeFixture } from "./fixtures/webcontainer";

const tree = (manifest = '{}', extra: FileSystemTree = {}): FileSystemTree => ({
  "package.json": { file: { contents: manifest } }, ...extra,
});
const services: WebContainerSessionService[] = [];
const create = (...args: ConstructorParameters<typeof WebContainerSessionService>) => {
  const service = new WebContainerSessionService(...args); services.push(service); return service;
};
afterEach(() => { services.splice(0).forEach(s => s.teardown()); vi.useRealTimers(); });

it("reuses a successful installation on restart and stop/start", async () => {
  const runtime = runtimeFixture();
  const service = create(async () => runtime.instance);
  await service.setup("a", tree());
  await service.restart(); service.stop(); await service.restart();
  expect(runtime.installs).toHaveLength(1);
  expect(runtime.servers).toHaveLength(3);
  expect(service.getState().startup).toMatchObject({kind: "warm", dependencies: "reused", installMs: 0});
});
it("coalesces simultaneous changed-manifest preparation and reinstalls exactly once", async () => {
  const runtime = runtimeFixture(); const service = create(async () => runtime.instance);
  await service.setup("a", tree());
  const changed = tree('{"dependencies":{"foo":"1"}}');
  const first = service.setup("a", changed);
  expect(service.setup("a", changed)).toBe(first);
  expect(service.setup("a", changed, true)).toBe(first);
  await first; await service.setup("a", changed);
  expect(runtime.installs).toHaveLength(2);
});
it.each(["package-lock.json", "npm-shrinkwrap.json", ".npmrc", "packages/sub/package.json"])("invalidates for changed %s", async path => {
  const runtime = runtimeFixture(); const service = create(async () => runtime.instance);
  await service.setup("a", tree());
  await service.writeFile(path, "changed");
  const changed = tree();
  if (path.includes("/")) changed.packages = {directory: {sub: {directory: {"package.json": {file: {contents: "changed"}}}}}};
  else changed[path] = {file: {contents: "changed"}};
  await service.setup("a", changed);
  expect(runtime.installs).toHaveLength(2);
});
it("source edits avoid installs unless installation scripts or local dependencies consume source", () => {
  const source = {"main.js": {file: {contents: "one"}}};
  const changed = {"main.js": {file: {contents: "two"}}};
  expect(dependencySignature(projectFiles(tree('{}', source)))).toBe(dependencySignature(projectFiles(tree('{}', changed))));
  for (const manifest of ['{"scripts":{"prepare":"node main.js"}}', '{"dependencies":{"local":"file:./lib"}}']) {
    expect(dependencySignature(projectFiles(tree(manifest, source)))).not.toBe(dependencySignature(projectFiles(tree(manifest, changed))));
  }
});
it("removes a deleted managed lockfile before installing", async () => {
  const runtime = runtimeFixture(); const service = create(async () => runtime.instance);
  await service.setup("a", tree('{}', {"package-lock.json": {file: {contents: "lock"}}}));
  await service.setup("a", tree());
  expect(runtime.instance.fs.rm).toHaveBeenCalledWith("package-lock.json", {force: true});
  expect(runtime.installs).toHaveLength(2);
});
it("installs a manifest saved during installation before starting the server", async () => {
  const exit = deferred<number>(); const runtime = runtimeFixture({installExits: [exit.promise]});
  const service = create(async () => runtime.instance);
  const setup = service.setup("a", tree()); await flushRuntime();
  await service.writeFile("package.json", '{"dependencies":{"foo":"1"}}');
  void service.setup("a", tree('{"dependencies":{"foo":"1"}}'));
  exit.resolve(0); await setup;
  expect(runtime.installs).toHaveLength(2); expect(runtime.servers).toHaveLength(1);
  await service.restart(); expect(runtime.installs).toHaveLength(2);
});
it("does not cache failed or cancelled installs, or share dependencies between projects", async () => {
  const first = runtimeFixture({installExits: [Promise.resolve(1), Promise.resolve(0)]});
  const second = runtimeFixture(); const service = create(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  await expect(service.setup("a", tree())).rejects.toThrow("exit code 1");
  await service.restart(); expect(first.installs).toHaveLength(2);
  await service.setup("b", tree()); expect(second.installs).toHaveLength(1);
});
it("invalidates successful dependencies after a user terminal command", async () => {
  const runtime = runtimeFixture(); const service = create(async () => runtime.instance);
  await service.setup("a", tree()); await service.spawn("npm", ["uninstall", "foo"]);
  await service.restart(); expect(runtime.installs).toHaveLength(2);
});
it("measures boot, mount, install, server and total independently with a controlled clock", async () => {
  let clock = 0; const runtime = runtimeFixture();
  vi.mocked(runtime.instance.mount).mockImplementation(async () => {clock += 20;});
  const spawn = vi.mocked(runtime.instance.spawn).getMockImplementation()! as unknown as
    (command: string, args: string[], options?: SpawnOptions) => Promise<WebContainerProcess>;
  vi.mocked(runtime.instance.spawn).mockImplementation(async (command: string, args?: string[] | SpawnOptions, options?: SpawnOptions) => {
    const argv = Array.isArray(args) ? args : [];
    clock += argv[0] === "install" ? 500 : 30; return spawn(command, argv, options);
  });
  const service = create(async () => {clock += 100; return runtime.instance;}, {now: () => clock});
  await service.setup("a", tree()); const cold = service.getState().startup!;
  await service.restart(); const warm = service.getState().startup!;
  expect(cold).toMatchObject({bootMs:100, mountMs:20, installMs:500, serverMs:30, totalMs:650});
  expect(warm).toMatchObject({bootMs:0, mountMs:20, installMs:0, serverMs:30, totalMs:50});
});

it("keeps ordinary source saves on the running server but reruns source-sensitive installation", async () => {
  const runtime = runtimeFixture(); const service = create(async () => runtime.instance);
  await service.setup("a", tree('{}', {"main.js": {file: {contents: "one"}}}));
  await service.writeFile("main.js", "two");
  await service.setup("a", tree('{}', {"main.js": {file: {contents: "two"}}}));
  expect(runtime.installs).toHaveLength(1); expect(runtime.servers).toHaveLength(1);
  const manifest = '{"scripts":{"prepare":"node main.js"}}';
  await service.setup("a", tree(manifest, {"main.js": {file: {contents: "two"}}}));
  await service.writeFile("main.js", "three");
  await service.setup("a", tree(manifest, {"main.js": {file: {contents: "three"}}}));
  expect(runtime.installs).toHaveLength(3);
});
it("replaces startup when a dependency save arrives while waiting for the server", async () => {
  const settings = {autoReady: false}; const runtime = runtimeFixture(settings);
  const service = create(async () => runtime.instance);
  const cancelled = expect(service.setup("a", tree())).rejects.toThrow("cancelled");
  await flushRuntime(); expect(service.getState().phase).toBe("starting");
  const manifest = '{"dependencies":{"foo":"1"}}';
  await service.writeFile("package.json", manifest); settings.autoReady = true;
  await service.setup("a", tree(manifest)); await cancelled;
  expect(runtime.installs).toHaveLength(2); expect(runtime.servers[0].process.kill).toHaveBeenCalledOnce();
});
it("retires partial npm installation and prepares dependencies in a fresh runtime after Stop", async () => {
  const first = runtimeFixture({installExits: [deferred<number>().promise]}); const second = runtimeFixture();
  const boot = vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance);
  const service = create(boot);
  const cancelled = expect(service.setup("a", tree())).rejects.toThrow("cancelled");
  await flushRuntime(); service.stop(); await cancelled; await service.restart();
  expect(first.instance.teardown).toHaveBeenCalledOnce(); expect(boot).toHaveBeenCalledTimes(2);
  expect(second.installs).toHaveLength(1); expect(service.getState().startup?.kind).toBe("cold");
});

it("does not let a retired mount overwrite the replacement session's managed file list", async () => {
  const first = runtimeFixture(); const second = runtimeFixture(); const mount = deferred<void>();
  vi.mocked(first.instance.mount).mockReturnValueOnce(mount.promise);
  const service = create(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance));
  const cancelled = expect(service.setup("a", tree('{}', {"old.js": {file: {contents: "old"}}}))).rejects.toThrow("cancelled");
  await flushRuntime(); await service.setup("b", tree()); await cancelled;
  mount.resolve(); await flushRuntime(); await service.restart();
  expect(second.instance.fs.rm).not.toHaveBeenCalledWith("old.js", {force: true});
  expect(second.installs).toHaveLength(1);
});

it("retires a timed-out npm process before retrying in a fresh container", async () => {
  vi.useFakeTimers();
  const first = runtimeFixture({installExits: [deferred<number>().promise]}); const second = runtimeFixture();
  const service = create(vi.fn().mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance), {installTimeoutMs: 10});
  const failed = expect(service.setup("a", tree())).rejects.toThrow("installation timed out");
  await flushRuntime(); await vi.advanceTimersByTimeAsync(11); await failed;
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  await service.restart(); expect(second.installs).toHaveLength(1);
  expect(service.getState().startup?.kind).toBe("cold");
});

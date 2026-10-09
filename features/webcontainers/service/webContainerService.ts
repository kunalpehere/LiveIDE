import { WebContainer, type FileSystemTree, type SpawnOptions, type WebContainerProcess } from "@webcontainer/api";
import { checkBrowserRuntimeSupport, UnsupportedRuntimeError } from "./browser-support";
import { reportClientError } from "@/lib/client-monitoring";
import { checkCancellation, RuntimeCancelledError, waitForOperation } from "./runtime-operation";
import { dependencySignature, projectFiles } from "./dependency-inputs";
import { consumeProcessOutput } from "./process-output";

export interface StartupMetrics {
  kind: "cold" | "warm";
  dependencies: "pending" | "installed" | "reused";
  bootMs: number | null;
  mountMs: number | null;
  installMs: number | null;
  serverMs: number | null;
  totalMs: number | null;
}

export type RuntimePhase = "idle" | "booting" | "mounting" | "installing" | "starting" |
  "ready" | "stopped" | "unsupported" | "failed";

export interface RuntimeState {
  phase: RuntimePhase;
  projectId: string | null;
  instance: WebContainer | null;
  serverUrl: string | null;
  error: string | null;
  startup: StartupMetrics | null;
}
type StateListener = () => void;
type OutputListener = (data: string) => void;
type Boot = () => Promise<WebContainer>;
interface SetupRun {
  projectId: string;
  controller: AbortController;
  promise: Promise<void>;
  pending: boolean;
  mutations: number;
  writeTail: Promise<void>;
  files: Map<string, string>;
  requestedFiles: string;
  startedAt: number;
  metrics: StartupMetrics;
}
interface SessionOptions {
  installTimeoutMs?: number;
  serverReadyTimeoutMs?: number;
  now?: () => number;
}
const initialState: RuntimeState = { phase: "idle", projectId: null, instance: null, serverUrl: null, error: null, startup: null };

export class WebContainerSessionService {
  private instance: WebContainer | null = null;
  private bootAttempt: { generation: number; promise: Promise<WebContainer> } | null = null;
  private setupTail: Promise<void> = Promise.resolve();
  private currentRun: SetupRun | null = null;
  private consumers = 0;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private processes = new Set<WebContainerProcess>();
  private unsubscribeRuntimeError: (() => void) | null = null;
  private state: RuntimeState = initialState;
  private stateListeners = new Set<StateListener>();
  private outputListeners = new Set<OutputListener>();
  private activeProject: string | null = null;
  private lastFiles: FileSystemTree | null = null;
  private pendingWrites = new Map<string, string>();
  private generation = 0;
  private installedSignature: string | null = null;
  private installing = false;
  private mountedPaths = new Set<string>();
  private now = () => this.options.now?.() ?? performance.now();
  private measure(run: SetupRun, update: Partial<StartupMetrics>) {
    run.metrics = { ...run.metrics, ...update };
    if (this.isCurrent(run)) this.setState({ startup: run.metrics });
  }

  constructor(private readonly boot: Boot = async () => {
    checkBrowserRuntimeSupport();
    return WebContainer.boot({ coep: "require-corp" });
  }, private readonly options: SessionOptions = {}) {}

  getState = () => this.state;
  getServerSnapshot = () => initialState;
  subscribe = (listener: StateListener) => {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  };
  subscribeOutput = (listener: OutputListener) => {
    this.outputListeners.add(listener);
    return () => { this.outputListeners.delete(listener); };
  };
  private setState(update: Partial<RuntimeState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.stateListeners) listener();
  }
  private isCurrent(run: SetupRun) {
    return this.currentRun === run && !run.controller.signal.aborted;
  }

  async acquire(): Promise<WebContainer> {
    this.consumers += 1;
    if (this.teardownTimer) clearTimeout(this.teardownTimer);
    this.teardownTimer = null;
    return this.getOrBoot();
  }
  release() {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers > 0 || this.teardownTimer) return;
    // Strict Mode's brief remount retains the lease and active container.
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      if (this.consumers === 0) this.teardown();
    }, 250);
  }

  private async getOrBoot(): Promise<WebContainer> {
    if (this.instance) return this.instance;
    if (this.bootAttempt) {
      const attempt = this.bootAttempt;
      if (attempt.generation === this.generation) return attempt.promise;
      // Only one SDK container may exist. Dispose a cancelled boot's late
      // result before starting its replacement, including across routes.
      const generation = this.generation;
      await attempt.promise.catch(() => undefined);
      if (generation !== this.generation) throw new RuntimeCancelledError();
      return this.getOrBoot();
    }
    const generation = this.generation;
    this.setState({ phase: "booting", serverUrl: null, error: null });
    const promise = Promise.resolve().then(() => this.boot()).then(instance => {
      if (generation !== this.generation) {
        instance.teardown();
        throw new RuntimeCancelledError();
      }
      this.instance = instance;
      this.unsubscribeRuntimeError = instance.on("error", ({ message }) => {
        if (generation !== this.generation) return;
        const error = new Error(message);
        if (this.currentRun && this.isCurrent(this.currentRun)) this.fail(this.currentRun, error);
        else {
          reportClientError("runtime.startup", error, this.state.phase);
          this.setState({ phase: "failed", serverUrl: null, error: message });
        }
        this.resetContainer();
      });
      this.setState({ instance, phase: this.state.phase === "booting" ? "idle" : this.state.phase });
      return instance;
    }).catch(error => {
      if (generation === this.generation && this.state.phase !== "stopped") {
        reportClientError("runtime.startup", error, "booting");
        this.setState({ phase: error instanceof UnsupportedRuntimeError ? "unsupported" : "failed",
          error: error instanceof Error ? error.message : String(error), serverUrl: null });
      }
      throw error;
    }).finally(() => {
      if (this.bootAttempt?.promise === promise) this.bootAttempt = null;
    });
    this.bootAttempt = { generation, promise };
    return promise;
  }

  setup(projectId: string, files: FileSystemTree, force = false): Promise<void> {
    const sameProject = this.activeProject === projectId;
    const requestedFiles = JSON.stringify([...projectFiles(files)].sort(([a], [b]) => a.localeCompare(b)));
    this.lastFiles = files;
    if (sameProject && this.currentRun?.pending && this.currentRun.mutations === 0 && this.isCurrent(this.currentRun) &&
      this.currentRun.requestedFiles === requestedFiles) return this.currentRun.promise;
    if (!force && sameProject) {
      if (this.currentRun?.pending && dependencySignature(projectFiles(files)) === dependencySignature(this.currentRun.files) &&
        (this.state.phase !== "starting" || this.installedSignature === dependencySignature(this.currentRun.files))) return this.currentRun.promise;
      if (this.state.phase === "ready" && this.currentRun &&
        dependencySignature(projectFiles(files)) === this.installedSignature) return this.currentRun.promise;
      // File saves must not implicitly resume a stopped or failed runtime.
      if (["stopped", "failed", "unsupported"].includes(this.state.phase)) return Promise.resolve();
    }
    this.cancelRun();
    if (!sameProject && this.activeProject !== null) {
      this.resetContainer();
      this.setupTail = Promise.resolve();
    }
    if (!sameProject) this.pendingWrites.clear();
    this.activeProject = projectId;
    this.setState({ projectId, phase: this.instance ? "mounting" : "booting", serverUrl: null, error: null });
    const run: SetupRun = { projectId, controller: new AbortController(), promise: Promise.resolve(), pending: true,
      mutations: 0, writeTail: Promise.resolve(), files: projectFiles(files), requestedFiles, startedAt: this.now(),
      metrics: { kind: this.installedSignature === null ? "cold" : "warm", dependencies: "pending",
        bootMs: null, mountMs: null, installMs: null, serverMs: null, totalMs: null } };
    this.currentRun = run;
    this.setState({ startup: run.metrics });
    const operation = this.setupTail.then(() => this.performSetup(run, files)).finally(() => { run.pending = false; });
    this.setupTail = operation.catch(() => undefined);
    run.promise = waitForOperation(operation, run.controller.signal);
    return run.promise;
  }
  restart() {
    if (!this.activeProject || !this.lastFiles) return Promise.resolve();
    return this.setup(this.activeProject, this.lastFiles, true);
  }
  stop(projectId = this.activeProject) {
    if (projectId !== this.activeProject) return;
    this.cancelRun();
    this.pendingWrites.clear();
    this.setState({ phase: "stopped", serverUrl: null, error: null });
  }

  private async performSetup(run: SetupRun, files: FileSystemTree) {
    const signal = run.controller.signal;
    try {
      checkCancellation(signal);
      const instance = await waitForOperation(this.getOrBoot(), signal);
      checkCancellation(signal);
      this.measure(run, { bootMs: this.now() - run.startedAt });
      const mountStarted = this.now();
      this.setState({ phase: "mounting", serverUrl: null, error: null });
      run.mutations += 1;
      try {
        for (const path of this.mountedPaths) {
          if (!run.files.has(path)) await instance.fs.rm(path, { force: true });
          checkCancellation(signal);
        }
        await instance.mount(files);
        checkCancellation(signal);
        this.mountedPaths = new Set(run.files.keys());
      }
      finally { run.mutations -= 1; }
      checkCancellation(signal);
      await this.flushWrites(run, instance);
      this.measure(run, { mountMs: this.now() - mountStarted });
      const installStarted = this.now();
      let didInstall = false;
      while (this.installedSignature !== dependencySignature(run.files)) {
        const signature = dependencySignature(run.files);
        this.installedSignature = null;
        this.installing = true;
        didInstall = true;
        this.setState({ phase: "installing" });
        let installSettled = false;
        try {
          const install = await this.spawnForRun(run, instance, "npm", ["install"]);
          this.pipeOutput(run, install);
          const installExit = await waitForOperation(install.exit, signal, this.options.installTimeoutMs ?? 180_000,
            "Dependency installation timed out. Retry the runtime.");
          installSettled = true;
          if (installExit !== 0) throw new Error(`Dependency installation failed with exit code ${installExit}`);
          checkCancellation(signal);
          await this.flushWrites(run, instance);
          // A manifest saved during installation requires a subsequent install.
          if (signature === dependencySignature(run.files)) this.installedSignature = signature;
        } finally { if (this.currentRun === run && installSettled) this.installing = false; }
      }
      this.measure(run, { installMs: didInstall ? this.now() - installStarted : 0,
        dependencies: didInstall ? "installed" : "reused" });
      const serverStarted = this.now();
      this.setState({ phase: "starting" });
      await this.startServer(run, instance);
      checkCancellation(signal);
      await this.flushWrites(run, instance);
      this.measure(run, { serverMs: this.now() - serverStarted, totalMs: this.now() - run.startedAt });
      this.setState({ phase: "ready" });
    } catch (error) {
      this.fail(run, error);
      throw error;
    }
  }

  private async startServer(run: SetupRun, instance: WebContainer) {
    const signal = run.controller.signal;
    let resolveReady!: (url: string) => void;
    const ready = new Promise<string>(resolve => { resolveReady = resolve; });
    const removeListener = instance.on("server-ready", (_port, url) => {
      if (this.isCurrent(run)) resolveReady(url);
    });
    let listening = true;
    const unsubscribe = () => { if (listening) { listening = false; removeListener(); } };
    signal.addEventListener("abort", unsubscribe, { once: true });
    try {
      const server = await this.spawnForRun(run, instance, "npm", ["run", "start"]);
      this.pipeOutput(run, server);
      const exitedBeforeReady = server.exit.then(code => {
        throw new Error(`Development server exited before becoming ready (exit code ${code})`);
      });
      const url = await waitForOperation(Promise.race([ready, exitedBeforeReady]), signal,
        this.options.serverReadyTimeoutMs ?? 60_000, "Development server did not become ready in time. Retry the runtime.");
      checkCancellation(signal);
      this.setState({ serverUrl: url });
      // Readiness is not permanent: the process can exit after serving a preview.
      void server.exit.then(code => {
        if (!this.isCurrent(run)) return;
        if (code === 0) this.stop(run.projectId);
        else this.fail(run, new Error(`Development server exited with code ${code}`));
      }, error => this.fail(run, error));
    } finally {
      signal.removeEventListener("abort", unsubscribe);
      unsubscribe();
    }
  }

  private async spawnForRun(run: SetupRun, instance: WebContainer, command: string, args: string[], options?: SpawnOptions) {
    checkCancellation(run.controller.signal);
    run.mutations += 1;
    let process: WebContainerProcess;
    try { process = await instance.spawn(command, args, options); }
    finally { run.mutations -= 1; }
    if (!this.isCurrent(run)) {
      process.kill();
      void process.exit.catch(() => undefined);
      checkCancellation(run.controller.signal);
      throw new RuntimeCancelledError();
    }
    this.processes.add(process);
    void process.exit.then(() => this.processes.delete(process), () => this.processes.delete(process));
    return process;
  }
  async spawn(command: string, args: string[] = [], options?: SpawnOptions, projectId = this.activeProject) {
    const run = this.currentRun;
    if (!run || !this.instance || projectId !== this.activeProject || this.state.phase !== "ready" || !this.isCurrent(run)) {
      throw new Error("Runtime is not ready. Start or retry it before running commands.");
    }
    // User shell commands may modify node_modules or manifests outside saves.
    this.installedSignature = null;
    return waitForOperation(this.spawnForRun(run, this.instance, command, args, options), run.controller.signal);
  }
  private pipeOutput(run: SetupRun, process: WebContainerProcess) {
    let outputBudget = 0;
    void consumeProcessOutput(process.output, run.controller.signal, async data => {
      if (!run.controller.signal.aborted) {
        // SDK output can arrive as many immediately-resolved chunks. Yield to
        // input/layout instead of starving the browser's task queue.
        outputBudget += data.length;
      }
      if (this.isCurrent(run)) for (const listener of this.outputListeners) listener(data);
      if (outputBudget >= 16 * 1024) { outputBudget = 0; await new Promise(resolve => setTimeout(resolve, 0)); }
    }).catch(error => this.fail(run, error));
  }
  async writeFile(filePath: string, content: string, projectId = this.activeProject) {
    const run = this.currentRun;
    const instance = this.instance;
    // Durable saves remain possible when execution is stopped or unavailable.
    if (!run || projectId !== this.activeProject || !this.isCurrent(run)) return;
    run.files.set(filePath, content);
    this.mountedPaths.add(filePath);
    this.pendingWrites.set(filePath, content);
    // Saves during startup are flushed at mount/install/readiness boundaries.
    if (!instance || this.state.phase !== "ready") return;
    try {
      await this.flushWrites(run, instance);
    } catch (error) {
      if (run.controller.signal.aborted) return;
      throw error;
    }
  }

  private flushWrites(run: SetupRun, instance: WebContainer) {
    const signal = run.controller.signal;
    const operation = run.writeTail.then(async () => {
      checkCancellation(signal);
      run.mutations += 1;
      try {
        while (this.pendingWrites.size) {
          checkCancellation(signal);
          const [filePath, content] = this.pendingWrites.entries().next().value!;
          const folder = filePath.split("/").slice(0, -1).join("/");
          if (folder) await instance.fs.mkdir(folder, { recursive: true });
          checkCancellation(signal);
          await instance.fs.writeFile(filePath, content);
          checkCancellation(signal);
          // A newer save may have arrived while this write was in flight.
          if (this.pendingWrites.get(filePath) === content) this.pendingWrites.delete(filePath);
        }
      } finally { run.mutations -= 1; }
    });
    run.writeTail = operation.catch(() => undefined);
    return waitForOperation(operation, signal);
  }

  private fail(run: SetupRun, error: unknown) {
    if (!this.isCurrent(run)) return;
    const phase = this.state.phase;
    reportClientError("runtime.setup", error, this.state.phase);
    this.cancelRun(error);
    if (phase === "mounting") this.resetContainer();
    this.setState({ phase: error instanceof UnsupportedRuntimeError ? "unsupported" : "failed", serverUrl: null,
      error: error instanceof Error ? error.message : String(error) });
  }
  private cancelRun(reason: unknown = new RuntimeCancelledError()) {
    const run = this.currentRun;
    run?.controller.abort(reason);
    if (this.installing) {
      this.installedSignature = null;
      this.installing = false;
      // Killing npm can leave partial dependency mutations in flight.
      this.resetContainer();
      this.setupTail = Promise.resolve();
    }
    for (const process of this.processes) process.kill();
    this.processes.clear();
    // Mount and spawn have no cancellation API. Retire their container so
    // late completion cannot mutate the replacement project's filesystem.
    if (run && run.mutations > 0) {
      this.resetContainer();
      this.setupTail = Promise.resolve();
    }
  }
  private resetContainer() {
    this.installedSignature = null;
    this.mountedPaths.clear();
    this.generation += 1;
    this.unsubscribeRuntimeError?.();
    this.unsubscribeRuntimeError = null;
    this.instance?.teardown();
    this.instance = null;
    this.setState({ instance: null });
    // Keep a pending boot as a barrier until its late result is disposed.
  }
  teardown() {
    this.cancelRun();
    if (this.teardownTimer) clearTimeout(this.teardownTimer);
    this.teardownTimer = null;
    this.resetContainer();
    this.setupTail = Promise.resolve();
    this.currentRun = null;
    this.activeProject = null;
    this.lastFiles = null;
    this.pendingWrites.clear();
    this.setState({ ...initialState, phase: "stopped" });
  }
}

const webContainerService = new WebContainerSessionService();
export default webContainerService;

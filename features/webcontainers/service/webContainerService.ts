import {
  WebContainer,
  type FileSystemTree,
  type SpawnOptions,
  type WebContainerProcess,
} from "@webcontainer/api";

export type RuntimePhase =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface RuntimeState {
  phase: RuntimePhase;
  serverUrl: string | null;
  error: string | null;
}

type StateListener = (state: RuntimeState) => void;
type OutputListener = (data: string) => void;
type Boot = () => Promise<WebContainer>;

const initialState: RuntimeState = { phase: "idle", serverUrl: null, error: null };

export class WebContainerSessionService {
  private instance: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private setupPromise: Promise<void> | null = null;
  private consumers = 0;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private processes = new Set<WebContainerProcess>();
  private unsubscribeServerReady: (() => void) | null = null;
  private serverReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private state: RuntimeState = initialState;
  private stateListeners = new Set<StateListener>();
  private outputListeners = new Set<OutputListener>();
  private activeProject: string | null = null;
  private lastFiles: FileSystemTree | null = null;

  constructor(private readonly boot: Boot = () => WebContainer.boot()) {}

  getState = () => this.state;

  subscribe = (listener: StateListener) => {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => { this.stateListeners.delete(listener); };
  };

  subscribeOutput = (listener: OutputListener) => {
    this.outputListeners.add(listener);
    return () => { this.outputListeners.delete(listener); };
  };

  private setState(update: Partial<RuntimeState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.stateListeners) listener(this.state);
  }

  private emitOutput(data: string) {
    for (const listener of this.outputListeners) listener(data);
  }

  async acquire(): Promise<WebContainer> {
    this.consumers += 1;
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    return this.getOrBoot();
  }

  release() {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers > 0 || this.teardownTimer) return;

    // Deferring teardown prevents React Strict Mode's test mount/unmount cycle
    // from booting a second WebContainer.
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      if (this.consumers === 0) this.teardown();
    }, 250);
  }

  private async getOrBoot() {
    if (this.instance) return this.instance;
    if (this.bootPromise) return this.bootPromise;

    this.setState({ phase: "booting", error: null });
    this.bootPromise = this.boot()
      .then(instance => {
        this.instance = instance;
        this.setState({ phase: "idle" });
        return instance;
      })
      .catch(error => {
        this.setState({ phase: "error", error: error instanceof Error ? error.message : String(error) });
        throw error;
      })
      .finally(() => {
        this.bootPromise = null;
      });
    return this.bootPromise;
  }

  async setup(projectId: string, files: FileSystemTree, force = false) {
    if (!force && this.activeProject === projectId) {
      if (this.setupPromise) return this.setupPromise;
      if (this.state.phase === "running") return;
    }

    this.activeProject = projectId;
    this.lastFiles = files;
    this.setupPromise = this.performSetup(files).finally(() => {
      this.setupPromise = null;
    });
    return this.setupPromise;
  }

  async restart() {
    if (!this.activeProject || !this.lastFiles) return;
    return this.setup(this.activeProject, this.lastFiles, true);
  }

  private async performSetup(files: FileSystemTree) {
    try {
      const instance = await this.getOrBoot();
      this.stopProcesses();
      this.clearServerReadyTimer();
      this.unsubscribeServerReady?.();
      this.unsubscribeServerReady = null;
      this.setState({ phase: "mounting", serverUrl: null, error: null });
      await instance.mount(files);

      this.setState({ phase: "installing" });
      const install = await this.spawn("npm", ["install"]);
      this.pipeOutput(install);
      const installExit = await install.exit;
      if (installExit !== 0) throw new Error(`Dependency installation failed with exit code ${installExit}`);

      this.setState({ phase: "starting" });
      const ready = new Promise<void>((resolve, reject) => {
        this.serverReadyTimer = setTimeout(
          () => reject(new Error("Development server did not become ready in 60 seconds")),
          60_000,
        );
        this.unsubscribeServerReady = instance.on("server-ready", (_port, url) => {
          this.clearServerReadyTimer();
          this.setState({ phase: "running", serverUrl: url, error: null });
          resolve();
        });
      });

      const server = await this.spawn("npm", ["run", "start"]);
      this.pipeOutput(server);
      await ready;
    } catch (error) {
      this.setState({ phase: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async spawn(command: string, args: string[] = [], options?: SpawnOptions) {
    const instance = await this.getOrBoot();
    const process = await instance.spawn(command, args, options);
    this.processes.add(process);
    void process.exit.finally(() => this.processes.delete(process));
    return process;
  }

  private pipeOutput(process: WebContainerProcess) {
    void process.output.pipeTo(new WritableStream({ write: data => this.emitOutput(data) })).catch(() => undefined);
  }

  async writeFile(filePath: string, content: string) {
    const instance = await this.getOrBoot();
    const folder = filePath.split("/").slice(0, -1).join("/");
    if (folder) await instance.fs.mkdir(folder, { recursive: true });
    await instance.fs.writeFile(filePath, content);
  }

  private stopProcesses() {
    for (const process of this.processes) process.kill();
    this.processes.clear();
  }

  private clearServerReadyTimer() {
    if (!this.serverReadyTimer) return;
    clearTimeout(this.serverReadyTimer);
    this.serverReadyTimer = null;
  }

  teardown() {
    this.stopProcesses();
    this.clearServerReadyTimer();
    this.unsubscribeServerReady?.();
    this.unsubscribeServerReady = null;
    this.instance?.teardown();
    this.instance = null;
    this.bootPromise = null;
    this.setupPromise = null;
    this.activeProject = null;
    this.lastFiles = null;
    this.setState(initialState);
  }
}

const webContainerService = new WebContainerSessionService();
export default webContainerService;

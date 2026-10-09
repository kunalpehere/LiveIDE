export const TERMINAL_SCROLLBACK = 1000;
export const TERMINAL_HISTORY_LIMIT = 200;
export const TERMINAL_INPUT_LIMIT = 4096;
export const TERMINAL_PENDING_LIMIT = 128 * 1024; // UTF-16 code units, at most 256 KiB
export const TERMINAL_BATCH_LIMIT = 16 * 1024;

// One xterm write in flight; callbacks provide parser backpressure. A timer
// between batches lets input/layout work run, including in background tabs.
export class TerminalOutputQueue {
  private buffer = new Uint16Array(TERMINAL_PENDING_LIMIT);
  private start = 0;
  private length = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private truncated = false;
  private notified = false;
  private reset: (() => void) | null = null;
  constructor(private write: (data: string, parsed: () => void) => void,
    private onTruncated: () => void = () => undefined,
    private onError: () => void = () => undefined) {}
  enqueue(data: string) {
    if (this.disposed) return;
    const overflow = this.length + data.length - TERMINAL_PENDING_LIMIT;
    if (overflow > 0) {
      const discarded = Math.min(this.length, overflow);
      this.start = (this.start + discarded) % TERMINAL_PENDING_LIMIT;
      this.length -= discarded;
      this.truncated = true;
      if (!this.notified) { this.notified = true; this.onTruncated(); }
    }
    // Copy into fixed storage; a substring tail could retain a huge backing string.
    for (let index = Math.max(0, data.length - TERMINAL_PENDING_LIMIT); index < data.length; index++) {
      this.buffer[(this.start + this.length) % TERMINAL_PENDING_LIMIT] = data.charCodeAt(index);
      this.length += 1;
    }
    this.schedule();
  }
  get pendingLength() { return this.length; }
  private schedule() {
    if (this.disposed || this.inFlight || this.timer || !this.length) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 16);
  }
  private flush() {
    if (this.disposed || this.inFlight) return;
    const count = Math.min(this.length, TERMINAL_BATCH_LIMIT);
    const chunk = new Uint16Array(count);
    for (let index = 0; index < count; index++) chunk[index] = this.buffer[(this.start + index) % TERMINAL_PENDING_LIMIT];
    const data = String.fromCharCode(...chunk);
    this.start = (this.start + count) % TERMINAL_PENDING_LIMIT;
    this.length -= count;
    const notice = this.truncated ? "\x18\x1b[0m\r\n[Older pending output omitted]\r\n" : "";
    this.truncated = false;
    this.inFlight = true;
    try { this.write(notice + data, () => {
      if (this.disposed) return;
      this.inFlight = false;
      this.reset?.(); this.reset = null;
      this.schedule();
    }); } catch { this.dispose(); this.onError(); }
  }
  clear(reset: () => void) {
    this.length = 0; this.start = 0; this.truncated = false; this.notified = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Clear after an already-submitted write has parsed, before new output.
    if (this.inFlight) this.reset = reset;
    else reset();
  }
  dispose() {
    this.disposed = true; this.length = 0; this.start = 0; this.reset = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

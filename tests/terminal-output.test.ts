import { afterEach, expect, it, vi } from "vitest";
import { TerminalOutputQueue, TERMINAL_PENDING_LIMIT, TERMINAL_BATCH_LIMIT } from "@/features/webcontainers/service/terminal-output";
afterEach(() => vi.useRealTimers());
it("accepts exactly the pending limit and reports overflow on the next unit", () => {
  vi.useFakeTimers(); const notice = vi.fn();
  const queue = new TerminalOutputQueue(() => undefined, notice);
  queue.enqueue("x".repeat(TERMINAL_PENDING_LIMIT));
  expect(queue.pendingLength).toBe(TERMINAL_PENDING_LIMIT);
  expect(notice).not.toHaveBeenCalled();
  queue.enqueue("x");
  expect(queue.pendingLength).toBe(TERMINAL_PENDING_LIMIT);
  expect(notice).toHaveBeenCalledOnce();
  queue.dispose();
});
it("batches chunks with one parser write in flight and yields between batches", () => {
  vi.useFakeTimers(); const parsed: Array<() => void> = []; const write = vi.fn((_data, callback) => parsed.push(callback));
  const queue = new TerminalOutputQueue(write);
  for(let i=0;i<1000;i++) queue.enqueue("line\n");
  expect(write).not.toHaveBeenCalled(); vi.advanceTimersByTime(16); expect(write).toHaveBeenCalledOnce();
  queue.enqueue("next"); vi.advanceTimersByTime(100); expect(write).toHaveBeenCalledOnce();
  parsed.shift()!(); vi.advanceTimersByTime(15); expect(write).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1); expect(write).toHaveBeenCalledTimes(2); queue.dispose();
});
it("bounds pending output and emits one truncation notice while retaining the newest tail", () => {
  vi.useFakeTimers(); const write = vi.fn((_data, callback) => callback()); const notice = vi.fn();
  const queue = new TerminalOutputQueue(write, notice);
  for(let i=0;i<10000;i++) queue.enqueue("x".repeat(100));
  queue.enqueue("LATEST"); expect(queue.pendingLength).toBe(TERMINAL_PENDING_LIMIT); expect(notice).toHaveBeenCalledOnce();
  vi.runAllTimers(); expect(write.mock.calls[0][0]).toContain("Older pending output omitted");
  expect(write.mock.calls.at(-1)![0]).toContain("LATEST");
  expect(write.mock.calls.every(([data]) => data.length <= TERMINAL_BATCH_LIMIT + 64)).toBe(true);
});
it("clear waits for the parser and prevents old queued output from reappearing", () => {
  vi.useFakeTimers(); const parsed: Array<() => void> = []; const write = vi.fn((_data, callback) => parsed.push(callback));
  const queue = new TerminalOutputQueue(write); const reset = vi.fn();
  queue.enqueue("in flight"); vi.advanceTimersByTime(16); queue.enqueue("discard"); queue.clear(reset); queue.enqueue("new");
  expect(reset).not.toHaveBeenCalled(); parsed.shift()!(); expect(reset).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(16); expect(write.mock.calls[1][0]).toBe("new"); queue.dispose();
});
it("disposal cancels scheduled writes and late callbacks", () => {
  vi.useFakeTimers(); let parsed!: () => void; const write = vi.fn((_data, callback) => {parsed=callback;});
  const queue = new TerminalOutputQueue(write); queue.enqueue("one"); vi.advanceTimersByTime(16);
  queue.enqueue("two"); queue.dispose(); parsed(); queue.enqueue("three"); vi.runAllTimers(); expect(write).toHaveBeenCalledOnce();
});
it("contains parser failures instead of throwing from the scheduled task", () => {
  vi.useFakeTimers(); const failed = vi.fn(); const queue = new TerminalOutputQueue(() => {throw new Error("parser failed");}, undefined, failed);
  queue.enqueue("one"); expect(() => vi.runAllTimers()).not.toThrow(); expect(failed).toHaveBeenCalledOnce(); expect(queue.pendingLength).toBe(0);
});

export class RuntimeCancelledError extends Error {
  constructor() {
    super("Runtime operation was cancelled");
    this.name = "RuntimeCancelledError";
  }
}

export function checkCancellation(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}

// Observe late SDK failures even after cancellation. The SDK has no AbortSignal.
export function waitForOperation<T>(promise: Promise<T>, signal: AbortSignal,
  timeoutMs?: number, timeoutMessage = "Runtime operation timed out"): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(signal.reason));
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), timeoutMs);
  });
}

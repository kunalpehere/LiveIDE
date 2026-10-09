// SDK-owned stream producers can close after process.kill(). Cancelling their
// source while stopping a consumer races that late close in the vendor bridge.
// Release our lock instead: pending reads reject, but the source remains healthy.
export async function consumeProcessOutput(stream: ReadableStream<string>, signal: AbortSignal,
  write: (data: string) => void | Promise<void>): Promise<void> {
  if (signal.aborted) return;
  const reader = stream.getReader();
  void reader.closed.catch(() => undefined);
  const release = () => { try { reader.releaseLock(); } catch { /* already released */ } };
  signal.addEventListener("abort", release, {once: true});
  try {
    while (!signal.aborted) {
      const {done, value} = await reader.read();
      if (done || signal.aborted) return;
      await write(value);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", release);
    release();
  }
}

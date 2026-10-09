import { z } from "zod";

const summarySchema = z.object({ count: z.number().int().nonnegative(), samples: z.number().int().nonnegative().max(256),
  meanMs: z.number().nonnegative(), p50Ms: z.number().nonnegative(), p95Ms: z.number().nonnegative(), maxMs: z.number().nonnegative() }).strict();
export const serverDiagnosticsSchema = z.object({ service: z.literal("liveide-collaboration"), activeSockets: z.number().int().nonnegative(),
  processing: summarySchema, authorization: summarySchema }).strict();

/** Bounded rolling sample window; count is lifetime, quantiles cover the window. */
export class TimingWindow {
  /** @type {number[]} */
  values = [];
  count = 0;
  /** @param {number} milliseconds */
  record(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.count++;
    if (this.values.length === 256) this.values.shift();
    this.values.push(milliseconds);
  }
  snapshot() {
    const values = [...this.values].sort((a, b) => a - b);
    const percentile = (/** @type {number} */ fraction) => values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
    return { count: this.count, samples: values.length, meanMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1) ?? 0 };
  }
}

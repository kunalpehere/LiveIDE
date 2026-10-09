import { expect, it } from "vitest";
import { TimingWindow } from "@/lib/collaboration-metrics.mjs";

it("bounds rolling timings and reports nearest-rank quantiles without invalid samples", () => {
  const window = new TimingWindow();
  for (const value of [-1, Infinity, NaN]) window.record(value);
  expect(window.snapshot()).toEqual({ count: 0, samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  for (let index = 1; index <= 300; index++) window.record(index);
  expect(window.snapshot()).toEqual({ count: 300, samples: 256, meanMs: 172.5, p50Ms: 172, p95Ms: 288, maxMs: 300 });
  const snapshot = window.snapshot(); window.record(0); expect(snapshot.count).toBe(300);
});

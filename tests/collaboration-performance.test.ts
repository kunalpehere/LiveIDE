import { expect, it } from "vitest";
import { runCollaborationPerformance } from "../scripts/collaboration-performance.mjs";

it.each([2, 5, 10])("converges %i real authorized clients without losing concurrent or offline edits", async clients => {
  const report = await runCollaborationPerformance([clients]);
  const result = report.scenarios[0];
  expect(result).toMatchObject({ clients, converged: true, lostUpdates: 0, concurrentEdits: clients * 5, offlineEdits: clients });
  expect(result.networkRoundTrip.count).toBe(clients * 5);
  expect(result.clientApplication.every(timing => timing.count > 0)).toBe(true);
}, 90_000);

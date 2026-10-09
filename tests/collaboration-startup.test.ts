import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("collaboration service startup safeguards", () => {
  const scenarios: { settings: Partial<NodeJS.ProcessEnv>; message: string }[] = [
    { settings: { COLLABORATION_SECRET: "", AUTH_SECRET: "sensitive-auth-material-do-not-log" }, message: "COLLABORATION_SECRET is required" },
    { settings: { NODE_ENV: "production", COLLABORATION_TEST_MODE: "true" }, message: "COLLABORATION_TEST_MODE must be false" },
    { settings: { COLLABORATION_PORT: "65536" }, message: "COLLABORATION_PORT has an invalid value" },
  ];
  it.each(scenarios)("exits before listening for invalid configuration: $message", ({ settings, message }) => {
    const result = spawnSync(process.execPath, ["scripts/collaboration-server.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "development", ENABLE_MOCK_DB: "false",
        COLLABORATION_TEST_MODE: "false", COLLABORATION_SECRET: "local-service-secret",
        COLLABORATION_PORT: "1234", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "",
        ...settings,
      },
      encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain("sensitive-auth-material-do-not-log");
  }, 40_000);
});

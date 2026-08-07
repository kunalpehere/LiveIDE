import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("database configuration", () => {
  it("fails clearly when DATABASE_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("ENABLE_MOCK_DB", "");
    vi.resetModules();

    await expect(import("@/lib/db")).rejects.toThrow("DATABASE_URL is required");
  });

  it("rejects mock mode outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_MOCK_DB", "true");
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();

    await expect(import("@/lib/db")).rejects.toThrow(
      "ENABLE_MOCK_DB may only be used when NODE_ENV=development",
    );
  });

  it("allows explicit mock mode during development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_MOCK_DB", "true");
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();

    const { db } = await import("@/lib/db");
    await expect(db.playground.findMany()).resolves.toBeDefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getApplicationConfiguration, getAuthConfiguration, getCollaborationConfiguration, getDatabaseConfiguration } from "@/lib/runtime-config.mjs";
import { register } from "@/instrumentation";

const authSecret = "91d76ac0048ef23b594069cdddfe8732b0a516cf7629804ee574312acd852609";
const collaborationSecret = "508ace271f83b0de4647ac98162fce090751dc6be238ef40231ab96750c84dee";
const production = {
  NODE_ENV: "production",
  DATABASE_URL: "mongodb://127.0.0.1:27017/liveide-test",
  AUTH_SECRET: authSecret,
  COLLABORATION_SECRET: collaborationSecret,
  NEXT_PUBLIC_COLLABORATION_URL: "wss://collaboration.example.com",
  COLLABORATION_APP_URL: "https://liveide.example.com",
};

afterEach(() => vi.unstubAllEnvs());

describe("runtime configuration", () => {
  it("returns typed flags and ports for valid production configuration", () => {
    const config = getApplicationConfiguration(production);
    expect(config.database.useMockDb).toBe(false);
    expect(config.auth.guestEnabled).toBe(false);
    expect(config.collaboration).toMatchObject({ port: 1234, testMode: false, secret: collaborationSecret });
  });

  it("allows database-free development only when mock mode is explicit", () => {
    expect(getApplicationConfiguration({ NODE_ENV: "development", ENABLE_MOCK_DB: "true", AUTH_SECRET: "local-secret" }).database.useMockDb).toBe(true);
    expect(() => getDatabaseConfiguration({ NODE_ENV: "development" })).toThrow("DATABASE_URL is required");
  });

  it("supports Atlas SRV and multi-host replica-set database URIs", () => {
    for (const databaseUrl of [
      "mongodb+srv://user:password@cluster.example.com/liveide",
      "mongodb://host1:27017,host2:27017/liveide?replicaSet=rs0",
    ]) {
      expect(getDatabaseConfiguration({ ...production, DATABASE_URL: databaseUrl }).databaseUrl).toBe(databaseUrl);
    }
  });

  it.each(["production", "test"])('rejects mock mode in %s', nodeEnv => {
    expect(() => getDatabaseConfiguration({ ...production, NODE_ENV: nodeEnv, ENABLE_MOCK_DB: "true" })).toThrow("ENABLE_MOCK_DB may only be used");
  });

  it.each([undefined, "", "replace-with-a-long-random-secret", "short", "a".repeat(64)])("rejects missing or unsafe production auth secrets", value => {
    expect(() => getAuthConfiguration({ NODE_ENV: "production", AUTH_SECRET: value })).toThrow("AUTH_SECRET");
  });

  it("supports a legacy auth alias but rejects conflicting aliases", () => {
    expect(getAuthConfiguration({ NODE_ENV: "production", NEXTAUTH_SECRET: authSecret }).authSecret).toBe(authSecret);
    expect(() => getAuthConfiguration({ ...production, NEXTAUTH_SECRET: collaborationSecret })).toThrow("NEXTAUTH_SECRET must match");
  });

  it.each([undefined, "", "postgres://localhost/liveide", "mongodb://localhost", "mongodb://localhost/liveide?tls=false", "mongodb+srv://<user>:<password>@cluster.example.com/liveide"])("rejects missing or unsafe database configuration", value => {
    expect(() => getDatabaseConfiguration({ ...production, DATABASE_URL: value })).toThrow("DATABASE_URL");
  });

  it("requires an independent collaboration secret without auth fallback", () => {
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_SECRET: undefined })).toThrow("COLLABORATION_SECRET is required");
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_SECRET: authSecret })).toThrow("must be different");
    expect(() => getCollaborationConfiguration({ NODE_ENV: "development", AUTH_SECRET: "local" }, true)).toThrow("COLLABORATION_SECRET is required");
  });

  it("allows collaboration to be disabled entirely", () => {
    const config = getApplicationConfiguration({ ...production, NEXT_PUBLIC_COLLABORATION_URL: "", COLLABORATION_SECRET: "" });
    expect(config.collaboration.websocketUrl).toBeUndefined();
    expect(config.collaboration.secret).toBeUndefined();
  });

  it.each(["short", "replace-with-another-long-random-secret"])("rejects unsafe collaboration secrets", value => {
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_SECRET: value })).toThrow("COLLABORATION_SECRET");
  });

  it("blocks insecure production collaboration URLs and service test mode", () => {
    expect(() => getCollaborationConfiguration({ ...production, NEXT_PUBLIC_COLLABORATION_URL: "ws://localhost:1234" })).toThrow("NEXT_PUBLIC_COLLABORATION_URL");
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_APP_URL: "http://localhost:3000" }, true)).toThrow("COLLABORATION_APP_URL");
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_APP_URL: undefined }, true)).toThrow("COLLABORATION_APP_URL is required");
    expect(() => getCollaborationConfiguration({ ...production, COLLABORATION_TEST_MODE: "true" }, true)).toThrow("COLLABORATION_TEST_MODE must be false");
  });

  it.each(["0", "65536", "abc", "1.5"])("rejects invalid service ports", port => {
    expect(() => getCollaborationConfiguration({ COLLABORATION_SECRET: "local", COLLABORATION_PORT: port }, true)).toThrow("COLLABORATION_PORT");
  });

  it("rejects malformed flags, provider pairs and Redis URLs", () => {
    expect(() => getApplicationConfiguration({ ...production, ENABLE_MOCK_DB: "yes" })).toThrow("ENABLE_MOCK_DB");
    expect(() => getAuthConfiguration({ ...production, AUTH_GITHUB_ID: "client" })).toThrow("must be configured together");
    expect(() => getCollaborationConfiguration({ ...production, REDIS_URL: "http://localhost" })).toThrow("REDIS_URL");
  });

  it("never includes credentials in validation errors", () => {
    const credential = "sensitive-do-not-print";
    for (const environment of [
      { ...production, DATABASE_URL: `https://user:${credential}@example.com/db` },
      { ...production, AUTH_SECRET: credential },
      { ...production, ENABLE_MOCK_DB: credential },
    ]) {
      try { getApplicationConfiguration(environment); throw new Error("Expected rejection"); }
      catch (error) {
        expect((error as Error).message).toContain("Invalid runtime configuration:");
        expect((error as Error).message).not.toContain(credential);
      }
    }
  });

  it("validates before the Next.js Node server accepts requests", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_MOCK_DB", "true");
    await expect(register()).rejects.toThrow("ENABLE_MOCK_DB");
  });
});

import { z } from "zod";

// Shared by Next.js and the plain Node.js collaboration process. JSDoc and
// Zod inference also give TypeScript callers a typed configuration contract.
/** @typedef {Record<string, string | undefined>} Environment */
const text = z.preprocess(value => value === "" ? undefined : value, z.string().optional());
const flag = z.preprocess(value => value === "" ? undefined : value,
  z.enum(["true", "false"]).default("false").transform(value => value === "true"));
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ENABLE_MOCK_DB: flag,
  DATABASE_URL: text,
  AUTH_SECRET: text,
  NEXTAUTH_SECRET: text,
  AUTH_GITHUB_ID: text,
  AUTH_GITHUB_SECRET: text,
  AUTH_GOOGLE_ID: text,
  AUTH_GOOGLE_SECRET: text,
  NEXT_PUBLIC_COLLABORATION_URL: text,
  COLLABORATION_SECRET: text,
  COLLABORATION_APP_URL: text,
  COLLABORATION_HOST: text,
  COLLABORATION_PORT: z.preprocess(value => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(65535).default(1234)),
  COLLABORATION_TEST_MODE: flag,
  REDIS_URL: text,
});

/** @param {string} setting @param {string} message @returns {never} */
function fail(setting, message) {
  throw new Error(`Invalid runtime configuration: ${setting} ${message}`);
}

/** @param {Environment} environment */
function read(environment) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    // Do not include Zod's received values, which may contain credentials.
    fail(result.error.issues.map(issue => issue.path.join(".")).join(", "), "has an invalid value");
  }
  const config = result.data;
  if (config.ENABLE_MOCK_DB && config.NODE_ENV !== "development") {
    fail("ENABLE_MOCK_DB", "may only be used when NODE_ENV=development");
  }
  if (config.COLLABORATION_TEST_MODE && config.NODE_ENV === "production") {
    fail("COLLABORATION_TEST_MODE", "must be false in production");
  }
  return config;
}

/** @param {string} name @param {string} value @param {string[]} protocols */
function url(name, value, protocols) {
  let parsed;
  try { parsed = new URL(value); } catch { fail(name, "must be a valid URL"); }
  if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.hash) {
    fail(name, `must use ${protocols.join(" or ")} with a host and no fragment`);
  }
  return parsed;
}

/** @param {string} name @param {string} value @param {boolean} production */
function secret(name, value, production) {
  if (!value.trim()) fail(name, "must not be blank");
  if (production && (value.length < 32 || new Set(value).size < 8 ||
    /replace|change.?me|example|playwright|verification|ci-only|development|test.?secret/i.test(value))) {
    fail(name, "must contain at least 32 characters and must not be a placeholder or trivial value in production");
  }
}

/** @param {Environment} [environment] */
export function getDatabaseConfiguration(environment = process.env) {
  const config = read(environment);
  const useMockDb = config.NODE_ENV === "development" && config.ENABLE_MOCK_DB;
  if (!useMockDb) {
    if (!config.DATABASE_URL) fail("DATABASE_URL", "is required outside development mock mode");
    // MongoDB replica-set URIs may contain several comma-separated hosts,
    // which the standard URL parser cannot parse as a single authority.
    const parts = /^(mongodb(?:\+srv)?:\/\/)([^/?#]+)(\/[^#]*)$/.exec(config.DATABASE_URL);
    if (!parts) fail("DATABASE_URL", "must be a MongoDB URI with a database name");
    const [, prefix, authority, suffix] = parts;
    const at = authority.lastIndexOf("@");
    const credentials = at >= 0 ? authority.slice(0, at + 1) : "";
    const hosts = authority.slice(at + 1).split(",");
    const databases = hosts.map(host => url("DATABASE_URL", `${prefix}${credentials}${host}${suffix}`, ["mongodb:", "mongodb+srv:"]));
    const database = databases[0];
    if (prefix === "mongodb+srv://" && (hosts.length !== 1 || database.port)) fail("DATABASE_URL", "SRV URIs require one host without a port");
    if (database.pathname.length < 2) fail("DATABASE_URL", "must specify a database name");
    if (config.NODE_ENV === "production" && (
      /replace|<|>/i.test(config.DATABASE_URL) ||
      database.searchParams.get("tls") === "false" || database.searchParams.get("ssl") === "false")) {
      fail("DATABASE_URL", "must not contain placeholders or explicitly disable TLS in production");
    }
  }
  return { nodeEnv: config.NODE_ENV, useMockDb, databaseUrl: config.DATABASE_URL };
}

/** @param {Environment} [environment] */
export function getAuthConfiguration(environment = process.env) {
  const config = read(environment);
  const authSecret = config.AUTH_SECRET || config.NEXTAUTH_SECRET;
  if (!authSecret) fail("AUTH_SECRET", "is required (NEXTAUTH_SECRET is accepted as a legacy alias)");
  secret("AUTH_SECRET", authSecret, config.NODE_ENV === "production");
  if (config.AUTH_SECRET && config.NEXTAUTH_SECRET && config.AUTH_SECRET !== config.NEXTAUTH_SECRET) {
    fail("NEXTAUTH_SECRET", "must match AUTH_SECRET when both are set");
  }
  for (const [id, credential, name] of [
    [config.AUTH_GITHUB_ID, config.AUTH_GITHUB_SECRET, "AUTH_GITHUB_ID / AUTH_GITHUB_SECRET"],
    [config.AUTH_GOOGLE_ID, config.AUTH_GOOGLE_SECRET, "AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET"],
  ]) {
    if (Boolean(id) !== Boolean(credential)) fail(name || "OAuth", "must be configured together");
  }
  return {
    authSecret,
    githubId: config.AUTH_GITHUB_ID, githubSecret: config.AUTH_GITHUB_SECRET,
    googleId: config.AUTH_GOOGLE_ID, googleSecret: config.AUTH_GOOGLE_SECRET,
    guestEnabled: config.NODE_ENV === "development" && config.ENABLE_MOCK_DB,
  };
}

/** @param {Environment} [environment] @param {boolean} [required] */
export function getCollaborationConfiguration(environment = process.env, required = false) {
  const config = read(environment);
  const production = config.NODE_ENV === "production";
  if ((required || config.NEXT_PUBLIC_COLLABORATION_URL) && !config.COLLABORATION_SECRET) {
    fail("COLLABORATION_SECRET", "is required for collaboration; authentication-secret fallback is not supported");
  }
  if (config.COLLABORATION_SECRET) {
    secret("COLLABORATION_SECRET", config.COLLABORATION_SECRET, production);
    if (config.COLLABORATION_SECRET === config.AUTH_SECRET || config.COLLABORATION_SECRET === config.NEXTAUTH_SECRET) {
      fail("COLLABORATION_SECRET", "must be different from the authentication secret");
    }
  }
  if (config.NEXT_PUBLIC_COLLABORATION_URL) {
    const websocket = url("NEXT_PUBLIC_COLLABORATION_URL", config.NEXT_PUBLIC_COLLABORATION_URL, production ? ["wss:"] : ["ws:", "wss:"]);
    if (websocket.username || websocket.password || websocket.search) fail("NEXT_PUBLIC_COLLABORATION_URL", "must not contain credentials or a query string");
  }
  if (required && production && !config.COLLABORATION_APP_URL) fail("COLLABORATION_APP_URL", "is required in production");
  const appUrl = config.COLLABORATION_APP_URL || "http://127.0.0.1:3000";
  if (config.COLLABORATION_APP_URL || required) {
    const app = url("COLLABORATION_APP_URL", appUrl, production ? ["https:"] : ["http:", "https:"]);
    if (app.username || app.password || app.search) fail("COLLABORATION_APP_URL", "must not contain credentials or a query string");
  }
  if (config.REDIS_URL) url("REDIS_URL", config.REDIS_URL, ["redis:", "rediss:"]);
  return {
    websocketUrl: config.NEXT_PUBLIC_COLLABORATION_URL,
    secret: config.COLLABORATION_SECRET,
    host: config.COLLABORATION_HOST || "127.0.0.1",
    port: config.COLLABORATION_PORT,
    appUrl, testMode: config.COLLABORATION_TEST_MODE, redisUrl: config.REDIS_URL,
  };
}

/** @param {Environment} [environment] */
export function getApplicationConfiguration(environment = process.env) {
  return {
    database: getDatabaseConfiguration(environment),
    auth: getAuthConfiguration(environment),
    collaboration: getCollaborationConfiguration(environment),
  };
}

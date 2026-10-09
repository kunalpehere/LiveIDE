import "server-only";

export function githubConfiguration() {
  const { GITHUB_CONNECTION_CLIENT_ID: clientId, GITHUB_CONNECTION_CLIENT_SECRET: clientSecret,
    GITHUB_CONNECTION_ENCRYPTION_KEY: encryptionKey, GITHUB_CONNECTION_ORIGIN: origin } = process.env;
  if (!clientId || !clientSecret || !encryptionKey || !origin) throw new Error("GitHub connection is not configured");
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
    (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Invalid GitHub connection origin");
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey) || new Set(encryptionKey).size < 8 ||
    encryptionKey === process.env.AUTH_SECRET || encryptionKey === process.env.NEXTAUTH_SECRET || encryptionKey === process.env.COLLABORATION_SECRET) throw new Error("Invalid GitHub encryption key");
  if (clientId === process.env.AUTH_GITHUB_ID) throw new Error("Use a separate repository OAuth app");
  return { clientId, clientSecret, encryptionKey, origin, callback: `${origin}/api/github/callback` };
}

export function githubConfigured() {
  try { githubConfiguration(); return true; } catch { return false; }
}

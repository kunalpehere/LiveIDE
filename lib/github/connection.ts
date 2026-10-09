import "server-only";
import { db } from "@/lib/db";
import { githubConfiguration, githubConfigured } from "./config";
import { decrypt, digest, encrypt, nonce } from "./crypto";
import { allowedScopes, exchangeCode, githubIdentity, GitHubRevoked, revokeToken } from "./provider";

export async function beginConnection(userId: string, access: "public" | "private", writeEnabled = false) {
  const config = githubConfiguration();
  const state = nonce(), verifier = nonce(), version = nonce();
  const pending = { version, pendingStateHash: digest(state), pendingVerifier: encrypt(verifier, `${userId}:pkce`),
    pendingExpiresAt: new Date(Date.now() + 600_000), pendingAccess: access, pendingWrite: writeEnabled };
  // Replacing an attempt invalidates earlier tabs. Keep an existing connection until success.
  await db.gitHubConnection.upsert({ where: { userId }, create: { userId, ...pending }, update: pending });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callback, state,
    scope: access === "private" ? "repo" : writeEnabled ? "public_repo" : "", code_challenge: digest(verifier), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), state };
}

export async function finishConnection(userId: string, state: string, code: string | null) {
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record?.pendingVerifier || record.pendingStateHash !== digest(state) || !record.pendingExpiresAt || record.pendingExpiresAt <= new Date()) throw new Error("Invalid authorization attempt");
  const claimed = await db.gitHubConnection.updateMany({ where: { userId, version: record.version,
    pendingStateHash: digest(state), pendingExpiresAt: { gt: new Date() } },
    data: { pendingStateHash: null, pendingVerifier: null, pendingExpiresAt: null, pendingAccess: null, pendingWrite: null } });
  if (claimed.count !== 1 || !code) throw new Error("Authorization cancelled or already used");
  const token = await exchangeCode(code, decrypt(record.pendingVerifier, `${userId}:pkce`));
  let previousToken: string | null = null;
  try {
    if (record.encryptedToken) previousToken = decrypt(record.encryptedToken, `${userId}:token`);
    const identity = await githubIdentity(token.access_token);
    if (!allowedScopes(token.scope, record.pendingAccess ?? "public", record.pendingWrite ?? false) || !allowedScopes(identity.scopes, record.pendingAccess ?? "public", record.pendingWrite ?? false)) throw new Error("Unexpected GitHub permissions");
    const saved = await db.gitHubConnection.updateMany({ where: { userId, version: record.version, pendingStateHash: null },
      data: { encryptedToken: encrypt(token.access_token, `${userId}:token`), githubUserId: identity.id,
        login: identity.login, access: record.pendingAccess, scopes: token.scope, writeEnabled: record.pendingWrite ?? false, connectedAt: new Date(), revokedAt: null } });
    if (saved.count !== 1) throw new Error("Authorization attempt was superseded");
  } catch (error) {
    // A superseding attempt can receive the same GitHub token. Do not revoke
    // a token that is still owned by the current connection.
    try {
      const current = await db.gitHubConnection.findUnique({ where: { userId } });
      const currentToken = current?.encryptedToken ? decrypt(current.encryptedToken, `${userId}:token`) : null;
      if (currentToken !== token.access_token) await revokeToken(token.access_token);
    } catch { /* Best-effort cleanup; the fixed failure UI links GitHub settings. */ }
    throw error;
  }
  // GitHub may return the same token on reauthorization. Never revoke that token.
  if (previousToken && previousToken !== token.access_token) {
    try { return { revocationPending: !await revokeToken(previousToken) }; }
    catch { return { revocationPending: true }; }
  }
  return { revocationPending: false };
}

export async function disconnectConnection(userId: string) {
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record) return { revocationPending: false };
  // Local access is removed before contacting GitHub. A stale callback cannot restore it.
  const removed = await db.gitHubConnection.updateMany({ where: { userId, version: record.version, encryptedToken: record.encryptedToken }, data: {
    version: nonce(), encryptedToken: null, pendingStateHash: null, pendingVerifier: null,
    pendingExpiresAt: null, pendingAccess: null, pendingWrite: null, writeEnabled: false, revokedAt: new Date(),
  } });
  if (removed.count !== 1) throw new Error("Connection changed; retry disconnect");
  if (!record.encryptedToken) return { revocationPending: false };
  try { return { revocationPending: !await revokeToken(decrypt(record.encryptedToken, `${userId}:token`)) }; }
  catch { return { revocationPending: true }; }
}

export async function connectionStatus(userId: string) {
  const configured = githubConfigured();
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record?.encryptedToken) return { configured, state: record?.revokedAt ? "revoked" : "disconnected", login: null, access: null };
  if (!configured) return { configured, state: "unavailable", login: record.login, access: record.access };
  try {
    const identity = await githubIdentity(decrypt(record.encryptedToken, `${userId}:token`));
    if (identity.id !== record.githubUserId || !allowedScopes(identity.scopes, record.access ?? "public", record.writeEnabled ?? false)) throw new GitHubRevoked();
    return { configured, state: "connected", login: identity.login, access: record.access, writeEnabled: record.writeEnabled ?? false };
  } catch (error) {
    if (error instanceof GitHubRevoked) {
      await db.gitHubConnection.updateMany({ where: { userId, version: record.version, encryptedToken: record.encryptedToken }, data: { encryptedToken: null, revokedAt: new Date() } });
      return { configured, state: "revoked", login: null, access: null };
    }
    return { configured, state: "unavailable", login: record.login, access: record.access };
  }
}

import "server-only";
import { db } from "@/lib/db";
import { githubConfigured } from "./config";
import { decrypt } from "./crypto";
import { allowedScopes } from "./provider";
import { BrowseError } from "./browse-error";
import { z } from "zod";

// Process-local cooldowns contain no provider credentials or repository data.
const state = globalThis as unknown as { liveideGitHubCooldowns?: Map<string, number> };
const cooldowns = state.liveideGitHubCooldowns ??= new Map<string, number>();
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function boundedJson(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new BrowseError("RESPONSE_TOO_LARGE", "GitHub returned too much data for this browser.", 422);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an invalid response.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new BrowseError("RESPONSE_TOO_LARGE", "GitHub returned too much data for this browser.", 422); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof BrowseError) throw error;
    throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an invalid response.", 502);
  } finally { reader.releaseLock(); }
}

export async function createBrowseClient(userId: string, signal?: AbortSignal) {
  if (!githubConfigured()) throw new BrowseError("NOT_CONFIGURED", "GitHub repository connection is not configured.", 503);
  const record = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!record?.encryptedToken) throw new BrowseError("CONNECTION_REQUIRED", "Connect or reconnect GitHub to browse repositories.", 409);
  let token: string;
  try { token = decrypt(record.encryptedToken, `${userId}:token`); }
  catch { throw new BrowseError("CONNECTION_REQUIRED", "Reconnect GitHub to restore repository access.", 409); }
  const cooldownKey = `${userId}:${record.version}`;
  async function invalidate(): Promise<never> {
    await db.gitHubConnection.updateMany({ where: { userId, version: record!.version, encryptedToken: record!.encryptedToken }, data: { encryptedToken: null, revokedAt: new Date() } });
    throw new BrowseError("CONNECTION_REVOKED", "GitHub access was revoked or changed. Reconnect GitHub.", 409);
  }
  async function request(path: string, body?: unknown) {
    if (body !== undefined) {
      if (!record!.writeEnabled) throw new BrowseError("WRITE_CONSENT_REQUIRED", "Reconnect GitHub with commits enabled before publishing.", 403);
      if (!/^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/git\/(blobs|trees|commits|refs)$/.test(path)) throw new BrowseError("INVALID_WRITE", "Unsupported GitHub operation.", 400);
      await assertActive();
    }
    const retryAt = cooldowns.get(cooldownKey);
    if (retryAt && retryAt > Date.now()) throw new BrowseError("RATE_LIMITED", "GitHub rate limit reached. Wait before retrying.", 429, retryAt);
    cooldowns.delete(cooldownKey);
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "LiveIDE" },
        cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    } catch { throw new BrowseError("PROVIDER_UNAVAILABLE", "GitHub could not be reached. Please retry.", 503); }
    if (response.status === 401) { await response.body?.cancel(); return invalidate(); }
    if (!response.ok) {
      let secondary = false;
      if (response.status === 403) {
        const body = await boundedJson(response).catch(() => null);
        secondary = !!body && typeof body === "object" && "message" in body && typeof body.message === "string" && /rate limit/i.test(body.message);
      }
      await response.body?.cancel();
      if (response.status === 429 || (response.status === 403 && (secondary || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
        const after = Number(response.headers.get("retry-after")); const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const until = Date.now() + Math.min(86_400_000, Math.max(60_000, after > 0 ? after * 1000 : reset > Date.now() ? reset - Date.now() : 60_000));
        for (const [key, expiry] of cooldowns) if (expiry <= Date.now()) cooldowns.delete(key);
        if (cooldowns.size < 1000 || cooldowns.has(cooldownKey)) cooldowns.set(cooldownKey, until);
        throw new BrowseError("RATE_LIMITED", "GitHub rate limit reached. Wait before retrying.", 429, until);
      }
      if (response.status === 403) throw new BrowseError("PERMISSION_DENIED", "GitHub denied access. Check repository permissions and organization or SSO restrictions.", 403);
      if (response.status === 404) throw new BrowseError("NOT_FOUND", "Repository, branch or file is unavailable, or GitHub has not granted access.", 404);
      if (response.status === 409) throw new BrowseError("EMPTY_REPOSITORY", "This repository has no source tree yet.", 409);
      if (response.status === 422) throw new BrowseError("GITHUB_REJECTED", "GitHub rejected this operation. Check branch rules, permissions and whether the branch already exists.", 422);
      throw new BrowseError("PROVIDER_UNAVAILABLE", "GitHub could not complete the request. Please retry.", 503);
    }
    if (!allowedScopes(response.headers.get("x-oauth-scopes") ?? "", record!.access ?? "public", record!.writeEnabled ?? false)) { await response.body?.cancel(); return invalidate(); }
    return { data: await boundedJson(response), hasNext: /rel="next"/.test(response.headers.get("link") ?? "") };
  }
  const get = (path: string) => request(path);
  const post = (path: string, body: unknown) => request(path, body);
  async function assertActive() {
    const current = await db.gitHubConnection.findUnique({ where: { userId } });
    if (!current?.encryptedToken || current.version !== record!.version || current.encryptedToken !== record!.encryptedToken) throw new BrowseError("CONNECTION_CHANGED", "GitHub connection changed. Refresh the repository browser.", 409);
  }
  const identity = z.object({ id: z.number().int().positive() }).safeParse((await get("/user")).data);
  if (!identity.success) throw new BrowseError("PROVIDER_RESPONSE", "GitHub returned an invalid response.", 502);
  if (String(identity.data.id) !== record.githubUserId) return invalidate();
  return { userId, githubUserId: record.githubUserId, version: record.version, access: record.access, writeEnabled: record.writeEnabled ?? false, get, post, assertActive };
}
export type BrowseClient = Awaited<ReturnType<typeof createBrowseClient>>;

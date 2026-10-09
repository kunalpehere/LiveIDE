import "server-only";
import { z } from "zod";
import { githubConfiguration } from "./config";

const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
export class GitHubUnavailable extends Error {}
export class GitHubRevoked extends Error {}

async function request(url: string, init: RequestInit) {
  try { return await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new GitHubUnavailable("GitHub is unavailable"); }
}

export async function exchangeCode(code: string, verifier: string) {
  const config = githubConfiguration();
  const response = await request("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code,
      redirect_uri: config.callback, code_verifier: verifier }),
  });
  if (!response.ok) throw new GitHubUnavailable("GitHub authorization failed");
  const result = z.object({ access_token: z.string().min(1).max(4096), token_type: z.literal("bearer"), scope: z.string().max(1024) }).safeParse(await response.json());
  if (!result.success) throw new Error("GitHub authorization failed");
  return result.data;
}

export async function githubIdentity(token: string) {
  const response = await request("https://api.github.com/user", { headers: { ...headers, Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new GitHubRevoked("GitHub access was revoked");
  if (!response.ok) throw new GitHubUnavailable("GitHub is unavailable");
  const identity = z.object({ id: z.number().int().positive(), login: z.string().regex(/^[a-zA-Z0-9-]{1,39}$/) }).parse(await response.json());
  return { id: String(identity.id), login: identity.login, scopes: response.headers.get("x-oauth-scopes") ?? "" };
}

export function allowedScopes(scopes: string, access: string, writeEnabled = false) {
  const granted = scopes.split(/[ ,]+/).filter(Boolean);
  return access === "private" ? granted.length === 1 && granted[0] === "repo" : writeEnabled ? granted.length === 1 && granted[0] === "public_repo" : granted.length === 0;
}

export async function revokeToken(token: string) {
  const { clientId, clientSecret } = githubConfiguration();
  const response = await request(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
    method: "DELETE", headers: { ...headers, "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    body: JSON.stringify({ access_token: token }),
  });
  return response.status === 204 || response.status === 404;
}

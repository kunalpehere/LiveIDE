import "server-only";
import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { githubConfiguration } from "./config";
import { BrowseError } from "./browse-error";
import { branchName, objectSha, ownerName, repositoryName, safePath } from "./browse-policy";
import type { BrowseClient } from "./browse-client";

const schema = z.object({ owner: ownerName, repo: repositoryName, branch: branchName, path: safePath,
  sha: objectSha, commitSha: objectSha, rootTreeSha: objectSha, kind: z.enum(["directory", "file"]), size: z.number().int().nonnegative().nullable(), version: z.string() });
type Navigation = z.infer<typeof schema>;
function key() { return createHmac("sha256", Buffer.from(githubConfiguration().encryptionKey, "hex")).update("liveide-github-navigation:v1").digest(); }
export async function signCursor(client: BrowseClient, data: Omit<Navigation, "version">) {
  return new SignJWT({ ...data, version: client.version }).setProtectedHeader({ alg: "HS256" }).setSubject(client.userId).setIssuer("liveide-github-browser").setAudience("github-navigation").setIssuedAt().setExpirationTime("30m").sign(key());
}
export async function readCursor(client: BrowseClient, value: string, kind: Navigation["kind"]) {
  try {
    const { payload } = await jwtVerify(value, key(), { algorithms: ["HS256"], issuer: "liveide-github-browser", audience: "github-navigation", subject: client.userId });
    const result = schema.parse(payload);
    if (result.kind !== kind || result.version !== client.version) throw new Error();
    return result;
  } catch { throw new BrowseError("INVALID_NAVIGATION", "This navigation reference expired or changed. Select the repository and branch again.", 400); }
}

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { json, sameOrigin } from "@/lib/github/http";
import { BrowseError } from "@/lib/github/browse-error";
import { commitInput, commitStatus, projectCommit } from "@/lib/github/project-commit";

export const runtime = "nodejs";
async function failure(error: unknown) {
  if (error instanceof BrowseError) {
    const response = json({ code: error.code, error: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }, error.status);
    if (error.retryAt) response.headers.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))));
    return response;
  }
  return json({ code: "COMMIT_UNAVAILABLE", error: "Could not complete the request. Refresh commit status to recover any recorded progress." }, 503);
}
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Sign in to review changes." }, 401);
  const query = new URL(request.url).searchParams;
  if (query.size !== 1 || !query.get("projectId") || query.get("projectId")!.length > 128) return json({ error: "Invalid project request." }, 400);
  try { return json(await commitStatus(session.user.id, query.get("projectId")!)); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Sign in to review changes." }, 401);
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Expected JSON." }, 400);
  const reader = request.body?.getReader(); let input;
  try {
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return json({ error: "Request is too large." }, 413); } chunks.push(value); }
    input = commitInput.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return json({ error: "Invalid commit request." }, 400); }
  finally { reader?.releaseLock(); }
  if (!input.success) return json({ error: "Invalid commit request; publishing and abandonment require explicit confirmation." }, 400);
  try {
    const result = await projectCommit(session.user.id, input.data, request.signal);
    if ("status" in result && result.status === "SUCCEEDED") revalidatePath(`/playground/${result.projectId}`);
    return json(result);
  } catch (error) { return failure(error); }
}

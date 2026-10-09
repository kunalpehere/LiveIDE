import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { json, sameOrigin } from "@/lib/github/http";
import { BrowseError } from "@/lib/github/browse-error";
import { AppError } from "@/lib/errors";
import { importInput, importRepository } from "@/lib/github/repository-import";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ code: "UNAUTHENTICATED", error: "Sign in to import a repository." }, 401);
  if (!sameOrigin(request)) return json({ code: "INVALID_ORIGIN", error: "Import must be requested from this app." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "INVALID_REQUEST", error: "Expected a JSON import request." }, 400);
  // Bound streaming bodies too; Content-Length is not trusted.
  const reader = request.body?.getReader();
  let body = "";
  try {
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 20_000) { await reader.cancel(); return json({ code: "INVALID_REQUEST", error: "Import request is too large." }, 413); }
      chunks.push(value);
    }
    body = Buffer.concat(chunks).toString("utf8");
  } catch { return json({ code: "INVALID_REQUEST", error: "Invalid import request." }, 400); }
  finally { reader?.releaseLock(); }
  let input;
  try { input = importInput.safeParse(JSON.parse(body)); }
  catch { return json({ code: "INVALID_REQUEST", error: "Invalid import request." }, 400); }
  if (!input.success) return json({ code: "INVALID_REQUEST", error: "Invalid import request." }, 400);
  try {
    const result = await importRepository(session.user.id, input.data, request.signal);
    if (input.data.action === "create") revalidatePath("/dashboard");
    return json(result);
  }
  catch (error) {
    if (error instanceof AppError) return json({ code: error.code, error: error.message }, error.status);
    if (error instanceof BrowseError) {
      const response = json({ code: error.code, error: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }, error.status);
      if (error.retryAt) response.headers.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))));
      return response;
    }
    return json({ code: "IMPORT_UNAVAILABLE", error: "Could not complete import. Retry the same review to recover the result safely." }, 503);
  }
}

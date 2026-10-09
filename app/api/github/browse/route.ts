import { auth } from "@/auth";
import { json } from "@/lib/github/http";
import { BrowseError } from "@/lib/github/browse-error";
import { browseInput, browseRepositories } from "@/lib/github/repository-browser";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ code: "UNAUTHENTICATED", error: "Sign in to browse GitHub repositories." }, 401);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return json({ code: "INVALID_REQUEST", error: "Invalid repository browsing request." }, 400);
  const input = browseInput.safeParse(Object.fromEntries(params));
  if (!input.success) return json({ code: "INVALID_REQUEST", error: "Invalid repository browsing request." }, 400);
  try { return json(await browseRepositories(session.user.id, input.data, request.signal)); }
  catch (error) {
    if (error instanceof BrowseError) {
      const response = json({ code: error.code, error: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }, error.status);
      if (error.retryAt) response.headers.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))));
      return response;
    }
    return json({ code: "BROWSE_UNAVAILABLE", error: "Could not load GitHub data. Please retry." }, 503);
  }
}

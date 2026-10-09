import { auth } from "@/auth";
import { finishConnection } from "@/lib/github/connection";
import { githubConfiguration } from "@/lib/github/config";
import { privateHeaders, stateCookie } from "@/lib/github/http";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  // All return locations are fixed. Never echo provider errors, codes or tokens.
  let origin: string;
  try { origin = githubConfiguration().origin; } catch {
    return NextResponse.json({ error: "GitHub connection is not configured." }, { status: 503, headers: privateHeaders });
  }
  let outcome = "failed";
  try {
    const session = await auth();
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    if (!session?.user?.id || request.nextUrl.origin !== origin || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      request.cookies.get(stateCookie)?.value !== state || (code && code.length > 1024)) throw new Error("Invalid callback");
    const result = await finishConnection(session.user.id, state, request.nextUrl.searchParams.has("error") ? null : code);
    outcome = result.revocationPending ? "connected-revocation-pending" : "connected";
  } catch { /* Safe, fixed UI message; provider response bodies must never be logged. */ }
  const response = NextResponse.redirect(`${origin}/dashboard/github?github=${outcome}`, { status: 303, headers: privateHeaders });
  response.cookies.set(stateCookie, "", { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/github", maxAge: 0 });
  return response;
}

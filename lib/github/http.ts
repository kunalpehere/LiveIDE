import "server-only";
import { NextResponse } from "next/server";
import { githubConfiguration } from "./config";

export const stateCookie = "liveide-github-state";
export const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Use a configured canonical origin, never an untrusted forwarded host.
  try { return origin === githubConfiguration().origin && new URL(request.url).origin === origin; }
  catch { return false; }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: privateHeaders });
}

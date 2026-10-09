import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import authConfig from "./auth.config";
import { getAuthRedirect } from "@/lib/auth-routing";
import { contentSecurityPolicy } from "@/lib/browser-security";
import { validId } from "@/lib/observability.mjs";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development", process.env.NEXT_PUBLIC_COLLABORATION_URL);
  const requestHeaders = new Headers(req.headers);
  const incomingId = req.headers.get("x-request-id");
  const requestId = validId(incomingId) ? incomingId! : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const redirect = getAuthRedirect(nextUrl.pathname, Boolean(req.auth));
  const response = redirect ? NextResponse.redirect(new URL(redirect, nextUrl)) : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("x-request-id", requestId);
  if (nextUrl.pathname.startsWith("/invitations/")) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

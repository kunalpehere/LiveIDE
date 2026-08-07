import NextAuth from "next-auth";

import authConfig from "./auth.config";
import { getAuthRedirect } from "@/lib/auth-routing";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const redirect = getAuthRedirect(nextUrl.pathname, Boolean(req.auth));
  return redirect ? Response.redirect(new URL(redirect, nextUrl)) : null;
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

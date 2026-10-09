import { DEFAULT_LOGIN_REDIRECT, apiAuthPrefix, authRoutes, publicRoutes } from "@/routes";

export function getAuthRedirect(pathname: string, isLoggedIn: boolean) {
  if (/^\/invitations\/[A-Za-z0-9_-]{43}$/.test(pathname)) return null;
  if (["/api/health", "/api/health/live", "/api/health/storage", "/api/monitoring", "/api/collaboration/snapshot", "/api/collaboration/access"].includes(pathname)) return null;
  if (pathname.startsWith(apiAuthPrefix)) return null;
  // These handlers enforce authentication and return JSON/fixed callback redirects.
  if (pathname.startsWith("/api/github/")) return null;
  if (authRoutes.includes(pathname)) return isLoggedIn ? DEFAULT_LOGIN_REDIRECT : null;
  if (!isLoggedIn && !publicRoutes.includes(pathname)) return "/auth/sign-in";
  return null;
}

export function invitationReturnPath(value: unknown) {
  return typeof value === "string" && /^\/invitations\/[A-Za-z0-9_-]{43}$/.test(value) ? value : "/dashboard";
}

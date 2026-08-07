import { DEFAULT_LOGIN_REDIRECT, apiAuthPrefix, authRoutes, publicRoutes } from "@/routes";

export function getAuthRedirect(pathname: string, isLoggedIn: boolean) {
  if (pathname.startsWith(apiAuthPrefix)) return null;
  if (authRoutes.includes(pathname)) return isLoggedIn ? DEFAULT_LOGIN_REDIRECT : null;
  if (!isLoggedIn && !publicRoutes.includes(pathname)) return "/auth/sign-in";
  return null;
}

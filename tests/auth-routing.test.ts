import { describe, expect, it } from "vitest";
import { getAuthRedirect, invitationReturnPath } from "@/lib/auth-routing";

describe("authentication routing", () => {
  it("permits invitation landing pages and only safe invitation return paths", () => {
    const path = `/invitations/${"a".repeat(43)}`;
    expect(getAuthRedirect(path, false)).toBeNull();
    expect(invitationReturnPath(path)).toBe(path);
    for (const input of ["//evil.example", "https://evil.example", "/invitations/short", [path], "/dashboard?next=evil"]) {
      expect(invitationReturnPath(input)).toBe("/dashboard");
    }
  });
  it("redirects anonymous users away from protected pages", () => {
    expect(getAuthRedirect("/dashboard", false)).toBe("/auth/sign-in");
    expect(getAuthRedirect("/playground/project", false)).toBe("/auth/sign-in");
  });

  it("allows the authentication route anonymously", () => {
    expect(getAuthRedirect("/", false)).toBe("/auth/sign-in");
    expect(getAuthRedirect("/auth/sign-in", false)).toBeNull();
  });

  it("redirects signed-in users away from sign-in", () => {
    expect(getAuthRedirect("/auth/sign-in", true)).toBe("/");
  });

  it("does not intercept Auth.js endpoints", () => {
    expect(getAuthRedirect("/api/auth/session", false)).toBeNull();
  });
  it("lets GitHub handlers enforce API authentication while protecting the settings page", () => {
    expect(getAuthRedirect("/api/github/connect", false)).toBeNull();
    expect(getAuthRedirect("/api/github/callback", false)).toBeNull();
    expect(getAuthRedirect("/dashboard/github", false)).toBe("/auth/sign-in");
  });
});

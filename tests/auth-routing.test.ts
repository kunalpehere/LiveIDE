import { describe, expect, it } from "vitest";
import { getAuthRedirect } from "@/lib/auth-routing";

describe("authentication routing", () => {
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
});

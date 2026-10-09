import { describe, expect, it } from "vitest";
import { browserSecurityHeaders, contentSecurityPolicy, avatarHosts } from "@/lib/browser-security";
import { runtimeSupportError } from "@/features/webcontainers/service/browser-support";

describe("browser security", () => {
  it("keeps production scripts nonce-based without JavaScript eval or wildcard origins", () => {
    const policy = contentSecurityPolicy("test-nonce", false, "wss://collab.example.com/socket");
    expect(policy).toContain("'nonce-test-nonce'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("wss://collab.example.com");
    expect(policy).not.toContain("/socket");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(avatarHosts).not.toContain("*");
  });

  it("allows development debugging and hot reload without forcing HTTPS", () => {
    const policy = contentSecurityPolicy("dev", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws://localhost:*");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(browserSecurityHeaders(false).find(header => header.key === "Strict-Transport-Security")).toBeUndefined();
  });

  it("sets isolation and production transport protection", () => {
    expect(browserSecurityHeaders(true)).toEqual(expect.arrayContaining([
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ]));
  });

  const supported = { secureContext: true, isolated: true, sharedArrayBuffer: true, webAssembly: true, worker: true, serviceWorker: true };
  it("recognizes capable browsers and explains missing capabilities", () => {
    expect(runtimeSupportError(supported)).toBeNull();
    expect(runtimeSupportError({ ...supported, secureContext: false })).toContain("HTTPS");
    expect(runtimeSupportError({ ...supported, isolated: false })).toContain("cross-origin isolation");
    expect(runtimeSupportError({ ...supported, sharedArrayBuffer: false })).toContain("SharedArrayBuffer");
    expect(runtimeSupportError({ ...supported, worker: false })).toContain("worker APIs");
  });
});

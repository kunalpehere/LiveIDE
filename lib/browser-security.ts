export const avatarHosts = ["avatars.githubusercontent.com", "lh3.googleusercontent.com"];

export function browserSecurityHeaders(production: boolean) {
  return [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}

export function contentSecurityPolicy(nonce: string, development: boolean, collaborationUrl?: string) {
  const collaborationOrigin = collaborationUrl ? new URL(collaborationUrl).origin : "";
  const runtimeFrames = "https://stackblitz.com https://*.webcontainer-api.io https://*.webcontainer.io https://*.local.webcontainer.io";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
    // Monaco, Radix and runtime panel layout use dynamic inline styles.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${avatarHosts.map(host => `https://${host}`).join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' ${runtimeFrames} ${collaborationOrigin}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    `frame-src 'self' ${runtimeFrames}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!development ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

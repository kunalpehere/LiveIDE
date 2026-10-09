# Browser and deployment security

## Headers and trust boundaries

Next.js is the single source for COOP/COEP and static security headers, through `lib/browser-security.ts` and `next.config.ts`. `vercel.json` no longer duplicates them. The application uses `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, matching the [WebContainer isolation requirements](https://webcontainers.io/guides/configuring-headers). Runtime boot uses the same COEP mode.

Responses also receive `nosniff`, frame denial, a restricted referrer policy, and camera/microphone/geolocation restrictions. Production adds HSTS without imposing it on unrelated subdomains. The application cannot be embedded in another site's frame. WebContainer previews run on separate vendor origins.

Remote image optimization accepts only HTTPS GitHub avatars and Google profile images from `avatars.githubusercontent.com` and `lh3.googleusercontent.com`. Additional image providers require an explicit reviewed allowlist change.

## Content Security Policy

Proxy generates a fresh nonce and overwrites incoming nonce/CSP request headers. It forwards the policy to the renderer and sets the response policy, including application redirects. Next.js applies the nonce to its scripts; the theme provider receives it explicitly. Pages already render dynamically through authentication and request headers.

Production script policy allows local scripts, nonce-authorized inline scripts, and WebAssembly compilation. JavaScript `unsafe-eval` is restricted to development debugging. Objects and framing the application are blocked; form submissions and base URLs are restricted to the application. WebContainer frame/connection sources are limited to its vendor domains, and collaboration connections to the configured origin.

Inline styles remain allowed because Monaco and the interface libraries generate dynamic styles. This is a documented CSP exception, not a fully strict style policy. The policy applies to application documents; it does not replace the separate trust boundary around code running inside the WebContainer runtime.

Monaco scripts, fonts, and workers are copied from the installed, lockfile-controlled package into ignored `public/monaco/` assets before development and production builds. No CDN script allowance is needed. The AMD loader is configured to prefer script tags rather than eval. Do not edit generated assets; update the dependency and rebuild instead.

## Browser capability checks and Strict Mode

Before booting a runtime, the application checks secure context, cross-origin isolation, SharedArrayBuffer, WebAssembly, Worker, and Service Worker availability. Missing capabilities display a clear explanation while file editing and saving remain available. These checks cannot detect every browser limitation, extension setting, or vendor outage; see the [WebContainer browser support guide](https://webcontainers.io/guides/browser-support).

React Strict Mode is enabled. Runtime consumers share one pending boot and defer teardown during the development remount cycle. A runtime that finishes booting after teardown is disposed instead of being retained. Monaco cursor/content subscriptions and terminal fit/resize timers are cleaned up explicitly.

## Verification and release checks

Run the normal lint, type checking, unit tests and production build, then `npm run test:e2e`. The browser suite requires a current production build and free ports 3100 and 3200. It starts both a development guest server and a production server with public build-only fixtures.

Browser checks verify headers, fresh nonces, rejection of unsigned inline scripts, capability failure messaging, file editing, and Monaco's TypeScript worker under the actual production CSP. Production checks use the anonymous sign-in page, so they do not require a running test database or enable production mock authentication.

Before a public deployment, verify real GitHub/Google OAuth redirects and profile images, a real WebContainer boot/install/process/preview, secure collaboration connectivity, and browser privacy settings on the deployment URL. These checks require configured credentials/services and remain deployment acceptance checks. No cloud deployment is performed as part of these changes.

## Local verification record

On October 5, 2026, lint, type checking, and the production build passed on Windows with Node.js 22.14.0. All 101 unit/integration tests and all seven Chromium browser tests passed. The production browser test ran Monaco's real TypeScript worker and received the expected type diagnostic without worker errors or JavaScript `unsafe-eval`.

The unsupported-isolation test verified the explanation before a file was selected and then opened a source file successfully. The browser suite also verified isolation headers, per-response nonces, blocked unsigned inline scripts, and existing guest project workflows. The deployment acceptance checks listed above remain pending; local verification does not certify real OAuth or a running production WebContainer preview.

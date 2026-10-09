import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "collaboration-test-results",
  reporter: [["list"], ["html", { outputFolder: "collaboration-playwright-report", open: "never" }]],
  testMatch: ["**/collaborator-follow.spec.ts", "**/notes-collaboration.spec.ts", "**/shared-runtime.spec.ts"],
  projects: [{ name: "collaboration-chromium", use: { browserName: "chromium" } }],
  webServer: [{
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!),
    env: {
      ...(Array.isArray(base.webServer) ? base.webServer[0].env : base.webServer?.env),
      NEXT_PUBLIC_COLLABORATION_URL: "ws://127.0.0.1:1235",
      COLLABORATION_SECRET: "browser-follow-local-secret",
      COLLABORATION_APP_URL: "http://127.0.0.1:3100",
    },
  }, {
    command: "npm run collaboration:server",
    url: "http://127.0.0.1:1235/healthz",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NODE_ENV: "development", COLLABORATION_HOST: "127.0.0.1", COLLABORATION_PORT: "1235",
      COLLABORATION_SECRET: "browser-follow-local-secret", COLLABORATION_APP_URL: "http://127.0.0.1:3100",
      COLLABORATION_TEST_MODE: "false", NEXT_PUBLIC_COLLABORATION_URL: "", REDIS_URL: "" },
  }],
});

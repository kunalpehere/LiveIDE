import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/auth/sign-in",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ENABLE_MOCK_DB: "true",
      AUTH_SECRET: "playwright-local-only-secret",
      NEXTAUTH_SECRET: "playwright-local-only-secret",
      NEXTAUTH_URL: "http://localhost:3000",
    },
  },
});

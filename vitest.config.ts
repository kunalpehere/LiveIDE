import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "reports/unit-tests.xml" },
  },
});

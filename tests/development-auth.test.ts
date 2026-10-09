import { describe, expect, it } from "vitest";

import { isGuestSignInEnabled } from "@/lib/development-auth";

describe("development guest authentication", () => {
  it("is enabled only for explicit non-production mock mode", () => {
    expect(isGuestSignInEnabled({ NODE_ENV: "development", ENABLE_MOCK_DB: "true" })).toBe(true);
    expect(isGuestSignInEnabled({ NODE_ENV: "development", ENABLE_MOCK_DB: "false" })).toBe(false);
    expect(isGuestSignInEnabled({ NODE_ENV: "production", ENABLE_MOCK_DB: "true" })).toBe(false);
    expect(isGuestSignInEnabled({ NODE_ENV: "test", ENABLE_MOCK_DB: "true" })).toBe(false);
    expect(isGuestSignInEnabled({ ENABLE_MOCK_DB: "true" })).toBe(false);
  });
});

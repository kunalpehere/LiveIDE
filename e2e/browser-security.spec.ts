import { expect, test } from "@playwright/test";

test("isolation and nonce policy are enforced in the browser", async ({ page }) => {
  const response = await page.goto("/auth/sign-in");
  const headers = response!.headers();
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const nonce = headers["content-security-policy"].match(/'nonce-([^']+)'/)![1];
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.locator("script").evaluateAll(scripts => scripts.some(script => script.nonce !== ""))).toBe(true);
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__untrustedScriptExecuted = true";
    document.head.appendChild(script);
  });
  expect(await page.evaluate(() => "__untrustedScriptExecuted" in window)).toBe(false);
  const second = await page.goto("/auth/sign-in");
  expect(second!.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
});

test("missing isolation explains runtime unavailability while editing remains usable", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "crossOriginIsolated", { value: false }));
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await expect(page.getByRole("heading", { name: "Browser runtime unavailable" })).toBeVisible();
  await expect(page.getByText(/requires cross-origin isolation and SharedArrayBuffer/)).toBeVisible();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.getByText("1 file(s) open", { exact: true })).toBeVisible();
});

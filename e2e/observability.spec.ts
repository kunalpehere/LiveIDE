import { expect, test } from "@playwright/test";

test("anonymous health checks distinguish development mocks from liveness", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect((await live.json()).status).toBe("healthy");
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(await response.json()).toMatchObject({ status: "degraded", dependencies: { database: { code: "DEVELOPMENT_MOCK" }, collaboration: { status: "disabled" } } });
});

test("browser failures reach monitoring without transmitting error contents", async ({ page }) => {
  await page.goto("/auth/sign-in");
  const received = page.waitForResponse(response => response.url().endsWith("/api/monitoring") && response.request().method() === "POST");
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("private-password-and-source-code") })));
  const response = await received;
  expect(response.status()).toBe(202);
  const payload = response.request().postDataJSON();
  expect(payload.source).toBe("browser.error");
  expect(payload.pageRequestId).toBe(await page.locator('meta[name="liveide-request-id"]').getAttribute("content"));
  expect(response.request().postData()).not.toContain("private-password");
  expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

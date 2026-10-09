import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Real SDK benchmark is opt-in: it needs access to WebContainer and npm hosts.
// It never substitutes a fixture when those services are unavailable.
test("measures real cold and retained warm runtime startup", async ({ page }, testInfo) => {
  test.skip(process.env.LIVEIDE_RUNTIME_BENCHMARK !== "1", "Opt-in real WebContainer/npm benchmark");
  test.setTimeout(300_000);
  await page.goto("/auth/sign-in");
  await page.getByRole("button", {name: "Continue as guest"}).click();
  await page.getByRole("link", {name: "React TypeScript Starter"}).first().click();
  await page.getByRole("button", {name: "App.tsx", exact: true}).click();
  const ready = page.locator('iframe[title="WebContainer Preview"]');
  try {
    await expect.poll(async () => {
      const error = page.getByRole("alert").filter({has: page.getByRole("heading", {name: /Runtime error|Browser runtime unavailable/})});
      if (await error.isVisible()) return await error.innerText();
      return await ready.isVisible() ? "ready" : "pending";
    }, {timeout: 240_000}).toBe("ready");
  } catch (error) {
    await testInfo.attach("runtime-startup-unavailable", {body: await page.locator("body").innerText(), contentType: "text/plain"});
    throw error;
  }
  const cold = await page.getByTestId("runtime-startup").innerText();
  await page.getByRole("button", {name: "Restart runtime", exact: true}).click();
  await expect(page.getByTestId("runtime-startup")).toContainText("Dependencies reused", {timeout: 60_000});
  await expect(ready).toBeVisible({timeout: 60_000});
  const warm = await page.getByTestId("runtime-startup").innerText();
  const measurements = JSON.stringify({measuredAt: new Date().toISOString(), project: "React TypeScript Starter", cold, warm}, null, 2);
  await testInfo.attach("runtime-startup-measurements", {body: measurements, contentType: "application/json"});
  await mkdir("reports", {recursive: true});
  await writeFile("reports/runtime-startup.json", measurements);
  const total = (text: string) => Number(text.match(/([\d.]+)s total/)?.[1]);
  expect(total(warm)).toBeLessThan(total(cold));
  await page.getByRole("button", {name: "Stop runtime", exact: true}).click();
});

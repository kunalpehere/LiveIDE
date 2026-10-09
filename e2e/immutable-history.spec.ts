import { expect, test } from "@playwright/test";

test("restoring preserves the named snapshot, records versions and a safety copy, and retains audit after deletion", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Project history", exact: true });
  await expect(dialog.getByText(/snapshots retained/)).toBeVisible();
  const name = `Immutable browser snapshot ${Date.now()}`;
  await dialog.getByRole("textbox", { name: "Snapshot name" }).fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const row = dialog.locator("div.rounded-md.border").filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toBeVisible();
  const originalVersionText = await row.locator("p.text-xs").innerText();
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await Promise.all([page.waitForEvent("load"), page.getByRole("dialog", { name: `Restore ${name}?`, exact: true }).getByRole("button", { name: "Restore", exact: true }).click()]);
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(row.locator("p.text-xs")).toHaveText(originalVersionText);
  await expect(dialog.getByText(`Before restoring ${name}`, { exact: true })).toBeVisible();
  await dialog.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(dialog.getByText(/Saved v\d+ → v\d+ from snapshot v\d+\. Safety snapshot:/)).toBeVisible();
  await dialog.getByRole("tab", { name: "Snapshots", exact: true }).click();
  await row.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  await expect(row).not.toBeVisible();
  await dialog.getByRole("tab", { name: "Activity", exact: true }).click();
  // The identity label varies by guest configuration; the event and snapshot name persist.
  await expect(dialog.locator("div.rounded-md.border").filter({ hasText: `deleted ${name}` })).toBeVisible();
  await expect(dialog.locator("div.rounded-md.border").filter({ hasText: `restored ${name}` })).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

async function signInAsGuest(page: Page) {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("anonymous user can enter the guest dashboard", async ({ page }) => {
  await signInAsGuest(page);
  await expect(page.getByRole("heading", { name: "Add New" })).toBeVisible();
  await expect(page.getByRole("link", { name: "React TypeScript Starter" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Next.js Starter" }).first()).toBeVisible();
});

test("guest can open a starter playground and select a source file", async ({ page }) => {
  await signInAsGuest(page);
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await expect(page).toHaveURL(/\/playground\/mock-playground-1$/);
  await expect(page.getByText("File Explorer", { exact: true })).toBeVisible();
  await page.getByText("App.tsx", { exact: true }).click();
  await expect(page.getByText("1 file(s) open", { exact: true })).toBeVisible();
});

test("playground owner can invite and remove a collaborator", async ({ page }) => {
  await signInAsGuest(page);
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "Share" }).click();

  await expect(page.getByRole("heading", { name: "Share playground" })).toBeVisible();
  await page.getByRole("textbox", { name: "Collaborator email" }).fill("collaborator@example.com");
  await page.getByRole("button", { name: "Invite" }).click();

  await expect(page.getByText("Collaborator User", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove collaborator@example.com" }).click();
  await expect(page.getByText("Collaborator User", { exact: true })).not.toBeVisible();
});

test("playground owner can create a named history snapshot", async ({ page }) => {
  await signInAsGuest(page);
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Project history" })).toBeVisible();

  const snapshotName = `E2E snapshot ${Date.now()}`;
  await page.getByRole("textbox", { name: "Snapshot name" }).fill(snapshotName);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(snapshotName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Delete ${snapshotName}` }).click();
  await expect(page.getByText(snapshotName, { exact: true })).not.toBeVisible();
});

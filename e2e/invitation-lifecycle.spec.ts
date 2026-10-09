import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

test("owner creates role-specific links, recipient accepts once, and revoked links deny access", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "chromium", "Uses the development database fixture");
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await expect(page).toHaveURL(/\/playground\/mock-playground-1$/);
  const projectUrl = page.url();
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  const name = "authjs.session-token";
  const value = await encode({ secret: "playwright-local-only-secret", salt: name,
    token: { sub: "mock-user-2", name: "Project Collaborator", email: "collaborator@example.com", role: "USER" } });
  await context.addCookies([{ name, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const recipient = await context.newPage();
  recipient.on("pageerror", error => errors.push(error.message));
  try {
    for (const role of ["VIEWER", "EDITOR"] as const) {
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await page.getByRole("combobox", { name: "Invitation role" }).selectOption(role);
      await page.getByRole("combobox", { name: "Invitation expiry" }).selectOption("1");
      await page.getByRole("button", { name: "Create invitation", exact: true }).click();
      const field = page.getByRole("textbox", { name: "Invitation link", exact: true });
      await expect(field).toHaveValue(/\/invitations\/[A-Za-z0-9_-]{43}$/);
      const link = await field.inputValue();
      // Opening and inspecting the link does not create membership.
      await recipient.goto(link);
      await expect(recipient.getByRole("button", { name: "Accept invitation", exact: true })).toBeVisible();
      await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
      await expect(recipient).toHaveURL(projectUrl);
      await recipient.getByRole("button", { name: "App.tsx", exact: true }).click();
      await expect(recipient.locator(".monaco-editor").first()).toBeVisible();
      await expect.poll(() => recipient.evaluate(async () => {
        const host = window as unknown as { require: (names: string[], callback: (monaco: typeof import("monaco-editor")) => void) => void };
        const monaco = await new Promise<typeof import("monaco-editor")>(resolve => host.require(["vs/editor/editor.main"], resolve));
        return monaco.editor.getEditors()[0]?.getOption(monaco.editor.EditorOption.readOnly);
      })).toBe(role === "VIEWER");
      await recipient.getByRole("button", { name: "Share", exact: true }).click();
      await expect(recipient.getByRole("button", { name: "Create invitation", exact: true })).toHaveCount(0);
      await recipient.keyboard.press("Escape");
      await recipient.goto(link);
      await expect(recipient.getByRole("status").filter({ hasText: "This invitation is used" })).toBeVisible();
      await expect(recipient.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
      // Reload owner management to see both the accepted member and used link.
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await expect(page.getByText("Project Collaborator", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Invitation links" }).getByText(/· used/).first()).toBeVisible();
      await page.getByRole("button", { name: "Remove collaborator@example.com", exact: true }).click();
      await expect(page.getByText("Project Collaborator", { exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: "Create invitation", exact: true }).click();
    const field = page.getByRole("textbox", { name: "Invitation link", exact: true });
    await expect(field).toHaveValue(/\/invitations\//);
    const revokedLink = await field.inputValue();
    await page.getByRole("button", { name: /^Revoke / }).first().click();
    await expect(field).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Invitation links" }).getByText(/· revoked/)).toBeVisible();
    await recipient.goto(revokedLink);
    await expect(recipient.getByRole("status").filter({ hasText: "This invitation is revoked" })).toBeVisible();
    await expect(recipient.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    await info.attach("invitation-management", { body: await page.screenshot(), contentType: "image/png" });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("anonymous invitation visitor signs in and returns to the invitation", async ({ page }) => {
  const path = `/invitations/${"a".repeat(43)}`;
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Project invitation", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sign in to continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue as guest", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("status").filter({ hasText: "Invitation not found" })).toBeVisible();
});

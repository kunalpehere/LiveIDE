import { expect, test } from "@playwright/test";
import type * as Monaco from "monaco-editor";

test("oversized save explains remediation, preserves the draft, and recovers after reducing it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  const original = await page.evaluateHandle(async () => {
    const browser = window as unknown as { require: (modules: string[], callback: (monaco: typeof Monaco) => void) => void };
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    const editor = monaco.editor.getEditors()[0];
    const model = editor.getModel()!;
    return { editor, model, text: model.getValue() };
  });
  await original.evaluate(({ editor, model }) => editor.executeEdits("resource-limit", [{ range: model.getFullModelRange(), text: "//" + "x".repeat(256 * 1024), forceMoveMarkers: true }]));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/exceeds 256 KiB.*Reduce/).first()).toBeVisible();
  expect(await original.evaluate(({ model }) => model.getValueLength())).toBe(256 * 1024 + 2);
  await original.evaluate(({ editor, model, text }) => editor.executeEdits("resource-recovery", [{ range: model.getFullModelRange(), text: text + "\n// resource limit recovery\n", forceMoveMarkers: true }]));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  const saved = await page.evaluate(async () => {
    const browser = window as unknown as { require: (modules: string[], callback: (monaco: typeof Monaco) => void) => void };
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    return monaco.editor.getEditors()[0].getValue();
  });
  expect(saved).toContain("resource limit recovery");
});

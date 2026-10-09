import { expect, test } from "@playwright/test";
import type * as Monaco from "monaco-editor";

test("runtime startup can stop and resume while editing and saving stay available", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  // If the SDK has already failed, exercise its in-place retry first.
  const retry = page.getByRole("button", { name: "Retry runtime", exact: true });
  if (await retry.isVisible()) await retry.click();
  await page.getByRole("button", { name: "Stop runtime", exact: true }).click();
  await expect(page.getByText("Runtime stopped", { exact: true })).toBeVisible();
  await expect(page.getByText("runtime: stopped", { exact: true })).toBeVisible();

  const original = await page.evaluateHandle(async () => {
    const browser = window as unknown as { require: (modules: string[], callback: (monaco: typeof Monaco) => void) => void };
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    const editor = monaco.editor.getEditors()[0];
    const model = editor.getModel()!;
    const text = model.getValue();
    editor.executeEdits("day13-test", [{ range: model.getFullModelRange(), text: `${text}\n// day13 saved draft`, forceMoveMarkers: true }]);
    return { monaco, editor, model, text };
  });
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("1 file(s) open", { exact: true })).toBeVisible();
  await expect(page.getByText("Runtime stopped", { exact: true })).toBeVisible();
  // Restore the shared guest project's source for following browser tests.
  await original.evaluate(({ editor, model, text }) => editor.executeEdits("day13-test", [{
    range: model.getFullModelRange(), text, forceMoveMarkers: true,
  }]));
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("1 file(s) open", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start runtime", exact: true }).click();
  await page.getByRole("button", { name: "Stop runtime", exact: true }).click();
  await expect(page.getByText("Runtime stopped", { exact: true })).toBeVisible();
  expect(await original.evaluate(({ monaco, editor, model, text }) =>
    monaco.editor.getEditors().includes(editor) && editor.getModel() === model && model.getValue() === text
  )).toBe(true);
  await original.dispose();
});

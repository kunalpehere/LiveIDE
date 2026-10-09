import { expect, test } from "@playwright/test";
import type * as Monaco from "monaco-editor";

test("panel changes retain Monaco and tab switches retain models and undo", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/api/code-suggestion", route => route.fulfill({
    json: { configured: true, provider: "test", model: "test" },
  }));
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();

  const original = await page.evaluateHandle(async () => {
    const browser = window as unknown as {
      require: (modules: string[], callback: (monaco: typeof Monaco) => void) => void;
    };
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    const editor = monaco.editor.getEditors()[0];
    const model = editor.getModel()!;
    const text = model.getValue();
    editor.setPosition({ lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount()) });
    editor.executeEdits("day12-test", [{ range: model.getFullModelRange(), text: `${text}\n// day12 draft`, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    return { monaco, editor, model, text };
  });
  const assertStable = async () => {
    expect(await original.evaluate(({ monaco, editor, model }) =>
      monaco.editor.getEditors().includes(editor) && editor.getModel() === model && !model.isDisposed()
    )).toBe(true);
  };
  await expect(page.getByText("1 file(s) open • Unsaved changes", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "false");
  await assertStable();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertStable();

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project history" })).toBeVisible();
  await assertStable();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: /Open AI chat/ }).click();
  await assertStable();
  await page.getByRole("button", { name: "Close chat" }).click();
  await assertStable();

  await page.getByRole("button", { name: "App.css", exact: true }).click();
  await expect(page.getByText("2 file(s) open • Unsaved changes", { exact: true })).toBeVisible();
  expect(await original.evaluate(({ editor, model }) => editor.getModel() !== model && !model.isDisposed())).toBe(true);
  await page.getByRole("tab", { name: /App.tsx/ }).click();
  await assertStable();
  expect(await original.evaluate(({ model }) => model.getValue().endsWith("// day12 draft"))).toBe(true);
  await original.evaluate(({ editor }) => editor.trigger("day12-test", "undo", null));
  expect(await original.evaluate(({ model, text }) => model.getValue() === text)).toBe(true);
  await expect(page.getByText("2 file(s) open", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.getByRole("menuitem", { name: "Close all files" }).click();
  await expect(page.getByText("No file selected", { exact: true })).toBeVisible();
  await expect.poll(() => original.evaluate(({ model }) => model.isDisposed())).toBe(true);
  await test.info().attach("browser-errors", { body: JSON.stringify(browserErrors), contentType: "application/json" });
  await original.dispose();
});

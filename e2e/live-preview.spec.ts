import { expect, test } from "@playwright/test";
import type * as Monaco from "monaco-editor";

test("live drafts and explicit Run update the real preview without saving", async ({ page }) => {
  test.skip(process.env.LIVEIDE_LIVE_PREVIEW !== "1", "Opt-in real WebContainer check");
  test.setTimeout(420_000);
  await page.goto("/auth/sign-in");
  await page.getByRole("button", {name:"Continue as guest"}).click();
  await page.getByRole("link", {name:"React TypeScript Starter"}).first().click();
  await page.getByRole("button", {name:"App.tsx", exact:true}).click();
  const preview = page.frameLocator('iframe[title="WebContainer Preview"]');
  await expect(preview.getByRole("heading")).toContainText("React TypeScript Starter", {timeout:240_000});
  const original = await page.evaluateHandle(async () => {
    const browser = window as unknown as {require:(modules:string[], callback:(monaco:typeof Monaco)=>void)=>void};
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    const editor = monaco.editor.getEditors()[0]; const model = editor.getModel()!;
    return {monaco, editor, model, text:model.getValue()};
  });
  const edit = async (title:string) => original.evaluate(({editor,model,text}, title) => {
    editor.executeEdits("live-preview-check", [{range:model.getFullModelRange(), text:text.replace("Welcome to React TypeScript Starter", title), forceMoveMarkers:true}]);
  }, title);
  const startup = await page.getByTestId("runtime-startup").innerText();
  await edit("Kunal manual draft");
  await expect(preview.getByRole("heading")).toContainText("React TypeScript Starter");
  await page.getByRole("button", {name:"Run", exact:true}).click();
  await expect(preview.getByRole("heading")).toHaveText("Kunal manual draft");
  await expect(page.getByRole("button", {name:"Save", exact:true})).toBeEnabled();
  await page.getByRole("checkbox", {name:"Live preview", exact:true}).check();
  await edit("Kunal live draft");
  await expect(preview.getByRole("heading")).toHaveText("Kunal live draft");
  expect(await page.getByTestId("runtime-startup").innerText()).toBe(startup);
  await expect(page.getByRole("button", {name:"Save", exact:true})).toBeEnabled();
  await page.getByRole("checkbox", {name:"Live preview", exact:true}).uncheck();
  await edit("Kunal paused draft"); await page.waitForTimeout(1000);
  await expect(preview.getByRole("heading")).toHaveText("Kunal live draft");
  await page.getByRole("button", {name:"Run", exact:true}).click();
  await expect(preview.getByRole("heading")).toHaveText("Kunal paused draft");
  await page.getByRole("button", {name:"Stop runtime", exact:true}).click();
  await expect(page.getByText("Runtime stopped", {exact:true})).toBeVisible();
  await edit("Kunal restarted draft");
  await page.getByRole("button", {name:"Run", exact:true}).click();
  await expect(preview.getByRole("heading")).toHaveText("Kunal restarted draft", {timeout:90_000});
  expect(await original.evaluate(({monaco,editor,model}) => monaco.editor.getEditors().includes(editor) && editor.getModel() === model)).toBe(true);
  await expect(page.getByRole("button", {name:"Save", exact:true})).toBeEnabled();
  await original.evaluate(({editor,model,text}) => editor.executeEdits("restore", [{range:model.getFullModelRange(), text, forceMoveMarkers:true}]));
  await page.getByRole("button", {name:"Run", exact:true}).click();
  await expect(preview.getByRole("heading")).toContainText("React TypeScript Starter");
  await page.getByRole("button", {name:"Stop runtime", exact:true}).click();
});

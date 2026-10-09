import { expect, test, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import type * as Monaco from "monaco-editor";

test("follow crosses files, follows selections and scroll, preserves drafts and stops on navigation, leave and access loss", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "collaboration-chromium", "Uses the dedicated real collaboration service configuration");
  test.setTimeout(240_000);
  const errors: string[] = [];
  // Runtime execution has its own suite; avoid two unrelated npm installations.
  await page.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("combobox", { name: "Invitation role", exact: true }).selectOption("VIEWER");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const invitationField = page.getByRole("textbox", { name: "Invitation link", exact: true });
  await expect(invitationField).toHaveValue(/\/invitations\/[A-Za-z0-9_-]{43}$/);
  const invitationLink = await invitationField.inputValue();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.getByText(/1 online/)).toBeVisible();
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  const cookieName = "authjs.session-token";
  const cookie = await encode({ secret: "playwright-local-only-secret", salt: cookieName,
    token: { sub: "mock-user-2", name: "Project Collaborator", email: "collaborator@example.com", role: "USER" } });
  await context.addCookies([{ name: cookieName, value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const follower = await context.newPage();
  follower.on("pageerror", error => errors.push(error.message));
  try {
    await follower.goto(invitationLink);
    await follower.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(follower).toHaveURL(page.url());
    await follower.getByRole("button", { name: "App.css", exact: true }).click();
    const leaderEditor = await editorHandle(page);
    const followerEditor = await editorHandle(follower);
    await expect.poll(() => leaderEditor.evaluate(({ editor }) => editor.getModel()?.getLineCount() || 0)).toBeGreaterThan(8);
    const follow = async () => {
      const select = follower.getByRole("combobox", { name: "Follow collaborator" });
      await expect(select.locator("option").filter({ hasText: "Local Developer" })).toHaveCount(1);
      const value = await select.locator("option").filter({ hasText: "Local Developer" }).getAttribute("value");
      await select.selectOption(value!);
      await expect(follower.getByText("Following Local Developer", { exact: true })).toBeVisible();
    };
    await follow();
    await expect(follower.getByRole("tab", { name: /App.tsx/ })).toHaveAttribute("data-state", "active");
    await leaderEditor.evaluate(({ editor }) => editor.setSelection({ selectionStartLineNumber: 8, selectionStartColumn: 4, positionLineNumber: 3, positionColumn: 2 }));
    await expect.poll(() => followerEditor.evaluate(({ editor }) => editor.getSelection()?.positionLineNumber)).toBe(3);
    await expect.poll(() => followerEditor.evaluate(({ editor }) => editor.getSelection()?.selectionStartLineNumber)).toBe(8);
    const followerText = await followerEditor.evaluate(({ editor }) => editor.getValue());
    await leaderEditor.evaluate(({ editor }) => editor.setScrollPosition({ scrollTop: 150 }));
    await expect.poll(async () => {
      const leader = await leaderEditor.evaluate(({ editor }) => editor.getScrollTop());
      const remote = await followerEditor.evaluate(({ editor }) => editor.getScrollTop());
      return Math.abs(leader - remote);
    }).toBeLessThan(2);
    expect(await followerEditor.evaluate(({ editor }) => editor.getValue())).toBe(followerText);
    await info.attach("viewer-following", { body: await follower.screenshot(), contentType: "image/png" });
    await page.getByRole("button", { name: "App.css", exact: true }).click();
    await expect(follower.getByRole("tab", { name: /App.css/ })).toHaveAttribute("data-state", "active");
    await follower.getByRole("tab", { name: /App.tsx/ }).click();
    await expect(follower.getByRole("button", { name: "Stop following" })).toHaveCount(0);
    await follow();
    await followerEditor.evaluate(({ editor }) => editor.getDomNode()?.dispatchEvent(new WheelEvent("wheel", { deltaY: 10 })));
    await expect(follower.getByRole("button", { name: "Stop following" })).toHaveCount(0);
    await follow();
    await follower.getByRole("button", { name: "Stop following" }).click();
    await follow();
    // Reverse direction: the editable owner follows a viewer while keeping a draft.
    await page.getByRole("tab", { name: /App.tsx/ }).click();
    const draft = await leaderEditor.evaluate(({ editor }) => {
      const model = editor.getModel()!; const text = model.getValue();
      editor.executeEdits("draft-check", [{ range: model.getFullModelRange(), text: `${text}\n// day16 preserved draft` }]);
      editor.pushUndoStop(); return { text, uri: model.uri.toString() };
    });
    await expect.poll(() => followerEditor.evaluate(({ editor }) => editor.getValue().endsWith("// day16 preserved draft"))).toBe(true);
    await expect(follower.getByText(/Collaboration access changed|could not reconnect/)).toHaveCount(0);
    await follower.getByRole("button", { name: "Stop following" }).click();
    await follower.getByRole("tab", { name: /App.css/ }).click();
    const ownerSelect = page.getByRole("combobox", { name: "Follow collaborator" });
    const viewerOption = ownerSelect.locator("option").filter({ hasText: "Project Collaborator" });
    await expect(viewerOption).toBeEnabled();
    await ownerSelect.selectOption((await viewerOption.getAttribute("value"))!);
    await expect(page.getByText("Following Project Collaborator", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /App.css/ })).toHaveAttribute("data-state", "active");
    await follower.close();
    await expect(page.getByRole("button", { name: "Stop following" })).toHaveCount(0);
    await page.getByRole("tab", { name: /App.tsx/ }).click();
    expect(await leaderEditor.evaluate(({ editor }, uri) => editor.getModel()?.uri.toString() === uri, draft.uri)).toBe(true);
    expect(await leaderEditor.evaluate(({ editor, model }) => editor.getModel() === model && !model.isDisposed())).toBe(true);
    expect(await leaderEditor.evaluate(({ editor }) => editor.getValue().endsWith("// day16 preserved draft"))).toBe(true);
    await leaderEditor.evaluate(({ editor }) => editor.trigger("draft-check", "undo", null));
    expect(await leaderEditor.evaluate(({ editor }) => editor.getValue())).toBe(draft.text);
    const revoked = await context.newPage();
    await revoked.goto(page.url());
    await revoked.getByRole("button", { name: "App.css", exact: true }).click();
    await expect(revoked.getByText(/Collaboration access changed|could not reconnect/)).toHaveCount(0);
    await expect(viewerOption).toBeEnabled();
    await ownerSelect.selectOption((await viewerOption.getAttribute("value"))!);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: "Remove collaborator@example.com" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Stop following" })).toHaveCount(0);
    await expect(page.getByText(/participant left/)).toBeVisible();
    await expect(revoked.getByRole("combobox", { name: "Follow collaborator" })).toBeDisabled();
    expect(errors).toEqual([]);
    await leaderEditor.dispose(); await followerEditor.dispose();
  } finally { await context.close().catch(() => {}); }
});

async function editorHandle(page: Page) {
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  return page.evaluateHandle(async () => {
    const browser = window as unknown as { require: (modules: string[], callback: (monaco: typeof Monaco) => void) => void };
    const monaco = await new Promise<typeof Monaco>(resolve => browser.require(["vs/editor/editor.main"], resolve));
    const editor = monaco.editor.getEditors()[0];
    return { editor, model: editor.getModel()! };
  });
}

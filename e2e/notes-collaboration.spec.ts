import { expect, test, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as Y from "yjs";
import { collaborationRoom, PROJECT_NOTES_PATH } from "../lib/collaboration-protocol.mjs";

test("notes converge separately from source drafts, reconnect, preview safely, persist, and enforce viewer/removal access", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "collaboration-chromium", "Uses the real collaboration service");
  test.setTimeout(240_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  await page.goto("/auth/sign-in"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "React TypeScript Starter" }).first().click();
  await expect(page).toHaveURL(/\/playground\/mock-playground-1$/);
  const projectUrl = page.url();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("textbox", { name: "Collaborator email" }).fill("collaborator@example.com");
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  await expect(page.getByText("Project Collaborator", { exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await expect(page.getByText(/1 online/)).toBeVisible();
  const source = await model(page, false);
  await expect.poll(() => source.evaluate(value => value.getValue().length)).toBeGreaterThan(20);
  await source.evaluate(value => { value.pushStackElement(); value.applyEdits([{ range: { startLineNumber: value.getLineCount(), startColumn: value.getLineMaxColumn(value.getLineCount()), endLineNumber: value.getLineCount(), endColumn: value.getLineMaxColumn(value.getLineCount()) }, text: "\n// source draft independent of notes" }]); });
  const draft = await source.evaluate(value => value.getValue());
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("Notes: connected", { exact: true })).toBeVisible();
  const ownerNotes = await model(page, true);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("complementary", { name: "Project notes", exact: true }).locator("textarea").focus();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(globalThis, "crossOriginIsolated", { value: false }));
  const cookieName = "authjs.session-token";
  const value = await encode({ secret: "playwright-local-only-secret", salt: cookieName, token: { sub: "mock-user-2", name: "Project Collaborator", email: "collaborator@example.com", role: "USER" } });
  await context.addCookies([{ name: cookieName, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const peer = await context.newPage(); peer.on("pageerror", error => errors.push(error.message));
  try {
    await peer.goto(projectUrl); await peer.getByRole("button", { name: "App.css", exact: true }).click();
    await peer.getByRole("button", { name: "Notes", exact: true }).click(); await expect(peer.getByText("Notes: connected", { exact: true })).toBeVisible();
    const peerNotes = await model(peer, true);
    await Promise.all([append(ownerNotes, "\nOwner decision"), append(peerNotes, "\nEditor plan")]);
    await expect.poll(() => ownerNotes.evaluate(value => value.getValue())).toContain("Editor plan");
    await expect.poll(() => peerNotes.evaluate(value => value.getValue())).toContain("Owner decision");
    await expect.poll(async () => (await ownerNotes.evaluate(value => value.getValue())) === (await peerNotes.evaluate(value => value.getValue()))).toBe(true);
    await page.getByRole("button", { name: "Close notes", exact: true }).click();
    expect(await source.evaluate(value => value.getValue())).toBe(draft);
    await page.getByRole("button", { name: "App.css", exact: true }).click();
    await append(peerNotes, "\nChanged while notes hidden");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect.poll(() => ownerNotes.evaluate(value => value.getValue())).toContain("Changed while notes hidden");
    await page.context().setOffline(true); await expect(page.getByText("Notes: offline", { exact: true })).toBeVisible();
    await append(ownerNotes, "\nOffline note"); await append(peerNotes, "\nOnline note"); await page.context().setOffline(false);
    await expect(page.getByText("Notes: connected", { exact: true })).toBeVisible();
    await expect.poll(() => peerNotes.evaluate(value => value.getValue())).toContain("Offline note");
    await expect.poll(() => ownerNotes.evaluate(value => value.getValue())).toContain("Online note");
    await append(ownerNotes, '\n\n# Notes preview\n\n**Safe formatting**\n\n<script>window.notesExecuted=true</script>\n\n[Unsafe](javascript:alert(1))\n\n![tracking](https://example.com/pixel.png)');
    await page.getByRole("button", { name: "Preview notes", exact: true }).click();
    const preview = page.getByLabel("Notes preview", { exact: true });
    await expect(preview.getByRole("heading", { name: "Notes preview", exact: true })).toBeVisible();
    await expect(preview.locator("script, iframe, img")).toHaveCount(0); await expect(preview.getByRole("link", { name: "Unsafe" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { notesExecuted?: boolean }).notesExecuted)).toBeUndefined();
    await info.attach("shared-notes-preview", { body: await page.screenshot(), contentType: "image/png" });
    const expected = await ownerNotes.evaluate(value => value.getValue());
    const checkpoint = `/api/collaboration/snapshot?${new URLSearchParams({ protocolVersion: "1", playgroundId: "mock-playground-1", filePath: PROJECT_NOTES_PATH, revision: "1", room: collaborationRoom("mock-playground-1", PROJECT_NOTES_PATH) })}`;
    await expect.poll(async () => {
      const response = await page.request.get(checkpoint, { headers: { "x-collaboration-secret": "browser-follow-local-secret" } });
      const result = await response.json(); if (!result.data?.state) return "";
      const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(result.data.state, "base64")); const text = doc.getText("content").toString(); doc.destroy(); return text;
    }).toBe(expected);
    await page.getByRole("button", { name: "Close notes", exact: true }).click(); await page.getByRole("tab", { name: /App.tsx/ }).click();
    expect(await source.evaluate(value => value.getValue())).toBe(draft); expect(await source.evaluate(value => value.isDisposed())).toBe(false);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("combobox", { name: "Role for collaborator@example.com", exact: true }).click(); await page.getByRole("option", { name: "Viewer", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(peer.getByText("Notes: failed", { exact: true })).toBeVisible();
    await peer.reload(); await peer.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(peer.getByText("Notes: connected · read-only", { exact: true })).toBeVisible();
    const viewerNotes = await model(peer, true); expect(await viewerNotes.evaluate(value => value.getValue())).toBe(expected);
    await expect.poll(() => peer.evaluate(async () => {
      const monaco = await loadMonaco(); return monaco.editor.getEditors().find(editor => editor.getModel()?.uri.scheme === "liveide-notes")?.getOption(monaco.editor.EditorOption.readOnly);
      function loadMonaco() { return new Promise<typeof import("monaco-editor")>(resolve => (window as unknown as { require: (names: string[], callback: (monaco: typeof import("monaco-editor")) => void) => void }).require(["vs/editor/editor.main"], resolve)); }
    })).toBe(true);
    await page.getByRole("button", { name: "Share", exact: true }).click(); await page.getByRole("button", { name: "Remove collaborator@example.com", exact: true }).click(); await page.keyboard.press("Escape");
    await expect(peer.getByText("Notes: failed · read-only", { exact: true })).toBeVisible();
    expect(errors).toEqual([]); await ownerNotes.dispose(); await peerNotes.dispose(); await viewerNotes.dispose();
  } finally { await page.context().setOffline(false); await context.close(); await source.dispose(); }
});

async function model(page: Page, notes: boolean) {
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await expect.poll(() => page.evaluate(async notes => {
    const monaco = await new Promise<typeof import("monaco-editor")>(resolve => (window as unknown as { require: (names: string[], callback: (monaco: typeof import("monaco-editor")) => void) => void }).require(["vs/editor/editor.main"], resolve));
    return monaco.editor.getModels().some(model => notes ? model.uri.scheme === "liveide-notes" : model.uri.scheme === "liveide" && model.uri.path.endsWith("/src/App.tsx"));
  }, notes)).toBe(true);
  return page.evaluateHandle(async notes => {
    const monaco = await new Promise<typeof import("monaco-editor")>(resolve => (window as unknown as { require: (names: string[], callback: (monaco: typeof import("monaco-editor")) => void) => void }).require(["vs/editor/editor.main"], resolve));
    return monaco.editor.getModels().find(model => notes ? model.uri.scheme === "liveide-notes" : model.uri.scheme === "liveide" && model.uri.path.endsWith("/src/App.tsx"))!;
  }, notes);
}
async function append(handle: Awaited<ReturnType<typeof model>>, text: string) {
  await handle.evaluate((model, text) => { const line = model.getLineCount(), column = model.getLineMaxColumn(line); model.applyEdits([{ range: { startLineNumber: line, endLineNumber: line, startColumn: column, endColumn: column }, text }]); }, text);
}

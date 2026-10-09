import { expect, test } from "@playwright/test";
const projectId = "mock-playground-1";
const source = { owner: "octocat", repository: "demo", branch: "main", folder: "src", commitSha: "a".repeat(40) };
const operation = { operationId: "browser-commit", status: "RECOVERABLE", branch: "codex/reviewed", message: "Update source", changes: [{ path: "app.ts", kind: "modified" }], commitSha: null, commitUrl: null, branchUrl: "https://github.com/octocat/demo/tree/codex/reviewed" };

test("owner reviews escaped diffs and explicitly confirms publishing a new branch", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  expect((await page.request.get(`/api/github/commit?projectId=${projectId}`)).status()).toBe(401);
  await page.goto(`/playground/${projectId}/github`); await expect(page).toHaveURL(/auth\/sign-in/);
  await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  let writes = 0;
  await page.route("**/api/github/commit**", route => {
    const input = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (!input) return route.fulfill({ json: { imported: true, source, operation: null } });
    if (input.action === "review") return route.fulfill({ json: { operationId: operation.operationId, repository: "octocat/demo", sourceBranch: "main", folder: "src", head: source.commitSha, branch: operation.branch, message: operation.message, conflicts: [], changes: [{ path: "app.ts", kind: "modified", before: "export const value = 1;", after: "<script>window.commitPreviewExecuted=true</script>" }, { path: "new.txt", kind: "added", before: "", after: "Added file" }, { path: "old.txt", kind: "deleted", before: "Old file", after: "" }] } });
    expect(input).toEqual({ action: "publish", operationId: operation.operationId, confirm: true }); writes++;
    return route.fulfill({ json: { ...operation, status: "SUCCEEDED", commitSha: "b".repeat(40), commitUrl: "https://github.com/octocat/demo/commit/b" } });
  });
  await page.goto(`/playground/${projectId}/github`);
  await page.getByRole("textbox", { name: "Commit message" }).fill("Update source");
  await page.getByRole("button", { name: "Review saved changes" }).click();
  await expect(page.getByRole("button", { name: "Confirm and publish new branch" })).toBeDisabled(); expect(writes).toBe(0);
  await page.getByText("modified: app.ts", { exact: true }).click();
  await expect(page.getByLabel("Diff app.ts")).toContainText("+ <script>");
  await expect(page.getByLabel("Diff app.ts").locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => "commitPreviewExecuted" in window)).toBe(false);
  await page.getByRole("checkbox", { name: /I confirm these exact saved changes/ }).check();
  await page.screenshot({ path: testInfo.outputPath("github-commit-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirm and publish new branch" }).click();
  await expect(page.getByRole("link", { name: "View GitHub commit" })).toHaveAttribute("href", "https://github.com/octocat/demo/commit/b"); expect(writes).toBe(1); expect(errors).toEqual([]);
});

test("owner recovers a recorded operation after reload without starting another review", async ({ page }) => {
  await page.goto("/dashboard"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  let recovered = false, publications = 0;
  await page.route("**/api/github/commit**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { imported: true, source, operation: { ...operation, ...(recovered ? { status: "SUCCEEDED", commitSha: "b".repeat(40), commitUrl: "https://github.com/octocat/demo/commit/b" } : {}) } } });
    expect(route.request().postDataJSON()).toEqual({ action: "publish", operationId: operation.operationId, confirm: true }); recovered = true; publications++;
    return route.fulfill({ json: { ...operation, status: "SUCCEEDED", commitSha: "b".repeat(40), commitUrl: "https://github.com/octocat/demo/commit/b" } });
  });
  await page.goto(`/playground/${projectId}/github`); await page.reload();
  await expect(page.getByRole("button", { name: "Recover confirmed commit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review saved changes" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /I confirm recovery/ }).check(); await page.getByRole("button", { name: "Recover confirmed commit" }).click();
  await expect(page.getByRole("link", { name: "View GitHub commit" })).toBeVisible(); expect(publications).toBe(1);
});

import { expect, test } from "@playwright/test";

test("GitHub connection is protected and shows disabled configuration safely", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard/github"); await expect(page).toHaveURL(/\/auth\/sign-in/);
  expect((await page.request.get("/api/github/connection")).status()).toBe(401);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("heading", { name: "GitHub connection" })).toBeVisible();
  await expect(page.getByText(/Ask your administrator/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Public repositories only" })).toBeChecked();
  const response = await page.request.get("/api/github/connection");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ configured: false, state: "disconnected", login: null, access: null });
  expect(errors).toEqual([]);
});

test("repository browser navigates paginated data and renders source as read-only text", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard/github/repositories"); await expect(page).toHaveURL(/\/auth\/sign-in/);
  expect((await page.request.get("/api/github/browse?action=repositories")).status()).toBe(401);
  await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.route("**/api/github/browse?**", async route => {
    const params = new URL(route.request().url()).searchParams;
    let data: unknown;
    if (params.get("action") === "repositories") data = { items: params.get("page") === "2" ? [] : [{ id: 1, owner: "octocat", name: "demo", private: false, defaultBranch: "main", description: "Browser fixture" }], page: Number(params.get("page")), hasNext: params.get("page") === "1" };
    else if (params.get("action") === "branches") data = { items: params.get("page") === "2" ? [{ name: "feature/ui", protected: false }] : [{ name: "main", protected: true }], page: Number(params.get("page")), hasNext: params.get("page") === "1" };
    else if (params.get("cursor") === "root" && params.get("page") === "2") data = { items: [{ name: "README.md", path: "README.md", kind: "file", cursor: "readme", size: 12, restriction: null }], path: "", branch: "feature/ui", treeSha: "a".repeat(40), cursor: "root", page: 2, hasNext: false };
    else if (params.get("action") === "tree" || params.get("cursor") === "root") data = { items: [{ name: "src", path: "src", kind: "directory", cursor: "src", size: null, restriction: null }, { name: "logo.png", path: "logo.png", kind: "file", cursor: null, size: 100, restriction: "This file type is not supported for text preview." }], path: "", branch: "feature/ui", treeSha: "a".repeat(40), cursor: "root", page: 1, hasNext: true };
    else if (params.get("action") === "directory") data = { items: [{ name: "app.ts", path: "src/app.ts", kind: "file", cursor: "file", size: 42, restriction: null }], path: "src", branch: "feature/ui", treeSha: "b".repeat(40), cursor: "src", page: 1, hasNext: false };
    else data = { path: "src/app.ts", branch: "feature/ui", sha: "c".repeat(40), size: 42, content: "<script>window.previewExecuted=true</script>" };
    await route.fulfill({ json: data });
  });
  await page.goto("/dashboard/github/repositories");
  await page.getByRole("button", { name: /octocat\/demo/ }).click();
  await page.getByRole("button", { name: "Next branches" }).click();
  await page.getByRole("combobox", { name: "Branch" }).selectOption("feature/ui");
  await expect(page.getByRole("button", { name: /logo.png/ })).toBeDisabled();
  await page.getByRole("button", { name: "Open folder src" }).click(); await page.getByRole("button", { name: /app.ts/ }).click();
  await expect(page.getByLabel("File preview")).toHaveText("<script>window.previewExecuted=true</script>");
  await expect(page.getByLabel("File preview").locator("script")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("repository-browser.png"), fullPage: true });
  await page.getByRole("button", { name: "Up one folder" }).click(); await expect(page.getByLabel("File preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Next files" }).click(); await expect(page.getByRole("button", { name: "Preview file README.md" })).toBeVisible();
  await page.getByRole("button", { name: "Previous files" }).click(); await expect(page.getByRole("button", { name: "Open folder src" })).toBeVisible();
  await page.route("**/api/github/import", route => {
    const input = route.request().postDataJSON();
    return route.fulfill({ json: input.action === "review" ? { plan: "browser-import-plan", title: "demo", fileCount: 2, bytes: 80, folder: "", commitSha: "d".repeat(40), template: "REACT", omitted: [{ path: "logo.png", reason: "Unsupported binary asset" }] } : { projectId: "browser-import-result", title: "demo" } });
  });
  await page.getByRole("button", { name: "Review import" }).click();
  await expect(page.getByLabel("Omitted import entries")).toContainText("logo.png");
  await expect(page.getByRole("button", { name: "Create imported project" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: testInfo.outputPath("repository-import-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Create imported project" }).click();
  await expect(page.getByRole("link", { name: "Open imported project" })).toHaveAttribute("href", "/playground/browser-import-result");
  await page.getByRole("button", { name: "Next repositories" }).click(); await expect(page.getByText(/No accessible repositories/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("repository browser explains permission failures and honors rate-limit cooldowns", async ({ page }) => {
  await page.goto("/dashboard"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  let calls = 0;
  let rateLimited = false;
  await page.route("**/api/github/browse?**", route => {
    calls++;
    return route.fulfill(!rateLimited ? { status: 403, json: { code: "PERMISSION_DENIED", error: "GitHub denied access. Check repository permissions and organization or SSO restrictions." } } : { status: 429, json: { code: "RATE_LIMITED", error: "GitHub rate limit reached. Wait before retrying.", retryAt: Date.now() + 120_000 } });
  });
  await page.goto("/dashboard/github/repositories"); await expect(page.getByRole("alert", { name: "Repository browsing error" })).toContainText("GitHub denied access.");
  const beforeRetry = calls; rateLimited = true;
  await page.getByRole("button", { name: "Retry" }).click(); await expect(page.getByRole("alert", { name: "Repository browsing error" })).toContainText("GitHub rate limit reached.");
  await expect(page.getByRole("button", { name: "Retry" })).toBeDisabled(); await expect(page.getByText(/Retry after/)).toBeVisible(); expect(calls).toBe(beforeRetry + 1);
});

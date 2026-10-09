import { expect, test } from "@playwright/test";

test("production health is public and reports real storage rather than development mocks", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect((await live.json()).status).toBe("healthy");
  const response = await request.get("/api/health/storage");
  const health = await response.json();
  expect(health.service).toBe("liveide-storage");
  expect(health.dependencies.database.code).not.toBe("DEVELOPMENT_MOCK");
  expect(["healthy", "unavailable"]).toContain(health.status);
  expect(response.status()).toBe(health.status === "unavailable" ? 503 : 200);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("production CSP renders nonce scripts and runs Monaco's TypeScript worker", async ({ page }) => {
  await page.addInitScript(() => {
    const stats = { created: 0, errors: 0 };
    (window as any).__workerStats = stats;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        stats.created += 1;
        worker.addEventListener("error", () => { stats.errors += 1; });
        return worker;
      },
    });
  });
  const response = await page.goto("/auth/sign-in");
  const policy = response!.headers()["content-security-policy"];
  expect(policy).toContain("'nonce-");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(response!.headers()["strict-transport-security"]).toBe("max-age=31536000");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  // The anonymous production page supplies the actual enforced policy. Mount
  // the installed Monaco assets there without needing production test users.
  const diagnostics = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.src = "/monaco/vs/loader.js";
    await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = reject; document.head.appendChild(script); });
    const amd = (window as any).require;
    amd.config({ paths: { vs: new URL("/monaco/vs", location.origin).href }, preferScriptTags: true });
    await new Promise<void>((resolve, reject) => amd(["vs/editor/editor.main"], resolve, reject));
    const monaco = (window as any).monaco;
    const element = document.createElement("div");
    element.style.cssText = "height:200px;width:500px";
    document.body.appendChild(element);
    const model = monaco.editor.createModel("const value: number = 'wrong';", "typescript");
    const editor = monaco.editor.create(element, { model });
    try {
      const workerFactory = await monaco.languages.typescript.getTypeScriptWorker();
      const worker = await workerFactory(model.uri);
      return {
        codes: (await worker.getSemanticDiagnostics(model.uri.toString())).map((diagnostic: any) => diagnostic.code),
        workers: (window as any).__workerStats,
      };
    } finally { editor.dispose(); model.dispose(); element.remove(); }
  });
  expect(diagnostics.codes).toContain(2322);
  expect(diagnostics.workers.created).toBeGreaterThan(0);
  expect(diagnostics.workers.errors).toBe(0);
});

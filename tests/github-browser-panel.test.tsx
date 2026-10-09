// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RepositoryBrowser } from "@/features/github/components/repository-browser";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const repository = { id: 1, owner: "octocat", name: "demo", private: false, description: null, defaultBranch: "main" };
const directory = { path: "", branch: "main", treeSha: "a".repeat(40), cursor: "root", page: 1, hasNext: false,
  items: [{ name: "src", path: "src", kind: "directory", cursor: "src", restriction: null, size: null }, { name: "logo.png", path: "logo.png", kind: "file", cursor: null, restriction: "This file type is not supported for text preview.", size: 10 }] };
function fixture() {
  const fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    if (params.get("action") === "repositories") return Response.json({ items: params.get("page") === "2" ? [] : [repository], page: Number(params.get("page")), hasNext: params.get("page") === "1" });
    if (params.get("action") === "branches") return Response.json({ items: [{ name: "main", protected: true }], page: 1, hasNext: false });
    if (params.get("action") === "tree" || params.get("cursor") === "root") return Response.json(directory);
    if (params.get("action") === "directory") return Response.json({ ...directory, cursor: "src", path: "src", items: [{ name: "app.ts", path: "src/app.ts", kind: "file", size: 12, restriction: null, cursor: "file" }] });
    return Response.json({ path: "src/app.ts", branch: "main", sha: "c".repeat(40), size: 12, content: "<script>window.previewExecuted=true</script>" });
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
it("navigates a branch, directory and safely escaped file preview", async () => {
  fixture(); render(<RepositoryBrowser />);
  fireEvent.click(await screen.findByRole("button", { name: /octocat\/demo/ }));
  fireEvent.change(await screen.findByRole("combobox", { name: "Branch" }), { target: { value: "main" } });
  await screen.findByText("This file type is not supported for text preview.");
  expect(screen.getByRole("button", { name: /logo.png/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Open folder src" }));
  fireEvent.click(await screen.findByRole("button", { name: /app.ts/ }));
  const preview = await screen.findByLabelText("File preview"); expect(preview.textContent).toContain("<script>"); expect(preview.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Up one folder" })); await screen.findByRole("button", { name: /logo.png/ });
  expect(screen.queryByLabelText("File preview")).not.toBeInTheDocument();
});
it("paginates repositories and clears the previous selection and source", async () => {
  fixture(); render(<RepositoryBrowser />);
  fireEvent.click(await screen.findByRole("button", { name: /octocat\/demo/ })); await screen.findByRole("combobox", { name: "Branch" });
  fireEvent.click(screen.getByRole("button", { name: "Next repositories" }));
  await screen.findByText(/No accessible repositories/); expect(screen.queryByRole("combobox", { name: "Branch" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next repositories" })).toBeDisabled();
});
it("shows reconnect and retry states without repeatedly fetching failures", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ code: "CONNECTION_REQUIRED", error: "Connect GitHub first." }, { status: 409 })).mockResolvedValue(Response.json({ items: [], page: 1, hasNext: false }));
  vi.stubGlobal("fetch", fetchMock); render(<RepositoryBrowser />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Connect GitHub first.");
  expect(screen.getByRole("link", { name: "Connect or reconnect GitHub" })).toHaveAttribute("href", "/dashboard/github");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText(/No accessible repositories/);
});
it("disables retry and navigation until a provider cooldown expires", async () => {
  const fetchMock = vi.fn(async () => Response.json({ code: "RATE_LIMITED", error: "GitHub rate limit reached.", retryAt: Date.now() + 120_000 }, { status: 429 }));
  vi.stubGlobal("fetch", fetchMock); render(<RepositoryBrowser />);
  await screen.findByText(/Retry after/); expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled(); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("cancels in-flight requests when unmounted", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise(() => {}); }));
  const view = render(<RepositoryBrowser />); await waitFor(() => expect(signal).toBeTruthy()); view.unmount(); expect(signal?.aborted).toBe(true);
});

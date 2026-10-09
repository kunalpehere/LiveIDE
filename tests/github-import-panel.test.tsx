// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RepositoryImport } from "@/features/github/components/repository-import";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const review = { plan: "signed-plan", title: "demo", fileCount: 2, bytes: 100, folder: "src", commitSha: "a".repeat(40), template: "REACT", omitted: [{ path: "logo.png", reason: "Unsupported file type" }] };
function panel() { const busy = vi.fn(); render(<RepositoryImport cursor="source" folder="src" defaultTitle="demo" disabled={false} onBusy={busy} />); return busy; }
it("reviews before writing and requires explicit omissions consent", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ projectId: "new-project", title: "demo" })); vi.stubGlobal("fetch", fetchMock);
  panel(); fireEvent.click(screen.getByRole("button", { name: "Review import" }));
  expect(await screen.findByLabelText("Omitted import entries")).toHaveTextContent("logo.png");
  const button = screen.getByRole("button", { name: "Create imported project" }); expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  expect(await screen.findByRole("link", { name: "Open imported project" })).toHaveAttribute("href", "/playground/new-project");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "review", cursor: "source", title: "demo" });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "create", plan: "signed-plan", acceptOmissions: true });
});
it("retains the same signed review for safe network retries and reports busy state", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...review, omitted: [] })).mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(Response.json({ projectId: "recovered", title: "demo" })); vi.stubGlobal("fetch", fetchMock);
  const busy = panel(); fireEvent.click(screen.getByRole("button", { name: "Review import" })); fireEvent.click(await screen.findByRole("button", { name: "Create imported project" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Retry the same review");
  fireEvent.click(screen.getByRole("button", { name: "Create imported project" }));
  await screen.findByRole("link", { name: "Open imported project" });
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
  expect(busy).toHaveBeenCalledWith(true); expect(busy).toHaveBeenLastCalledWith(false);
});
it("honors cooldowns and lets the user change an expired review", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...review, omitted: [] })).mockResolvedValueOnce(Response.json({ error: "Wait before retrying.", code: "RATE_LIMITED", retryAt: Date.now() + 120000 }, { status: 429 })); vi.stubGlobal("fetch", fetchMock);
  panel(); fireEvent.click(screen.getByRole("button", { name: "Review import" })); fireEvent.click(await screen.findByRole("button", { name: "Create imported project" }));
  await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Create imported project" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Change import review" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "New project name" })).toBeEnabled());
});

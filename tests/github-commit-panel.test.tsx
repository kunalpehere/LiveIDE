// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GitHubCommitPanel } from "@/features/github/components/commit-panel";
import { lineDiff } from "@/features/github/lib/line-diff";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const status = { imported: true, source: { owner: "octocat", repository: "demo", branch: "main", folder: "", commitSha: "a".repeat(40) }, operation: null };
const review = { operationId: "review-id", repository: "octocat/demo", sourceBranch: "main", folder: "", head: "a".repeat(40), branch: "codex/new", message: "Update", conflicts: [], changes: [{ path: "app.ts", kind: "modified", before: "const old = 1;", after: "<script>window.executed=true</script>" }] };
const operation = { operationId: "review-id", status: "RECOVERABLE", branch: "codex/new", message: "Update", changes: [{ path: "app.ts", kind: "modified" }], commitSha: null, commitUrl: null, branchUrl: "https://github.com/octocat/demo/tree/codex/new" };
it("requires review and explicit confirmation, displays escaped diffs, and links the published result", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ ...operation, status: "SUCCEEDED", commitSha: "b".repeat(40), commitUrl: "https://github.com/octocat/demo/commit/b" })); vi.stubGlobal("fetch", fetchMock);
  render(<GitHubCommitPanel projectId="project" title="Demo" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review saved changes" }));
  const publish = await screen.findByRole("button", { name: "Confirm and publish new branch" }); expect(publish).toBeDisabled();
  const diff = screen.getByLabelText("Diff app.ts"); expect(diff.textContent).toContain("- const old = 1;"); expect(diff.textContent).toContain("+ <script>"); expect(diff.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(publish); await screen.findByRole("link", { name: "View GitHub commit" });
  expect(screen.getByText(/Source branch codex\/new/)).toBeVisible();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: "publish", operationId: "review-id", confirm: true });
});
it("offers durable recovery after reload and enforces separate abandonment consent", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...status, operation })).mockResolvedValueOnce(Response.json({ ...operation, status: "CANCELLED" })); vi.stubGlobal("fetch", fetchMock);
  render(<GitHubCommitPanel projectId="project" title="Demo" />);
  expect(await screen.findByRole("button", { name: "Recover confirmed commit" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Abandon unpublished operation" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Abandon this operation/ })); fireEvent.click(screen.getByRole("button", { name: "Abandon unpublished operation" }));
  await screen.findByRole("button", { name: "Review saved changes" }); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "cancel", operationId: "review-id", confirm: true });
});
it("blocks publication when the review contains remote conflicts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json({ ...review, conflicts: ["app.ts"], operationId: null })));
  render(<GitHubCommitPanel projectId="project" title="Demo" />); fireEvent.click(await screen.findByRole("button", { name: "Review saved changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Remote files changed"); expect(screen.queryByRole("button", { name: "Confirm and publish new branch" })).not.toBeInTheDocument();
});
it("highlights changed middle lines and bounds work for very large diffs", () => {
  expect(lineDiff("first\nold\nlast", "first\nnew\nlast")).toEqual([{ kind: "same", text: "first" }, { kind: "removed", text: "old" }, { kind: "added", text: "new" }, { kind: "same", text: "last" }]);
  expect(lineDiff("a\n".repeat(1000), "b\n".repeat(1000))).toBeNull();
});

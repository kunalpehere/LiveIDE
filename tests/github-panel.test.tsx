// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GitHubConnectionPanel } from "@/features/github/components/connection-panel";

beforeEach(() => { window.history.replaceState(null, "", "/dashboard/github"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("defaults to public access and explains the broad private permission", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ configured: true, state: "disconnected", login: null, access: null })));
  render(<GitHubConnectionPanel />);
  await screen.findByText("GitHub is disconnected.");
  expect(screen.getByRole("radio", { name: "Public repositories only" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Enable commits/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Enable commits/ }));
  expect(screen.getByText(/Public commit access requests public_repo/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Public and private repositories" }));
  expect(screen.getByText(/includes read and write access/)).toBeVisible();
});
it("requires a deliberate disconnect and explains failed provider revocation", async () => {
  let connected = true;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { connected = false; return Response.json({ revocationPending: true }); }
    return Response.json({ configured: true, state: connected ? "connected" : "revoked", login: connected ? "octocat" : null, access: "public" });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<GitHubConnectionPanel />); await screen.findByText(/Connected as octocat/);
  fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/ }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Confirm disconnect" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await screen.findByText(/GitHub revocation could not be confirmed/);
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Disconnect$/ })).not.toBeInTheDocument());
});
it("disables authorization until configured and supports retry after load failures", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(Response.json({ configured: false, state: "disconnected", login: null, access: null }));
  vi.stubGlobal("fetch", fetchMock); render(<GitHubConnectionPanel />);
  await screen.findByText(/Could not load/); expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" })); await screen.findByText(/Ask your administrator/);
  expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeDisabled();
});

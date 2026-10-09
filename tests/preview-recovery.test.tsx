// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PreviewFrame, { PREVIEW_LOAD_TIMEOUT_MS } from "@/features/webcontainers/components/preview-frame";
import RuntimePanelBoundary from "@/features/webcontainers/components/runtime-panel-boundary";
afterEach(() => {cleanup(); vi.useRealTimers();});
it("shows navigation readiness and reloads only the iframe", () => {
  const restart = vi.fn(); render(<PreviewFrame url="https://preview.example" onRestart={restart}/>);
  const frame = screen.getByTitle("WebContainer Preview"); fireEvent.load(frame);
  expect(screen.getByText("Preview frame loaded")).toBeVisible();
  const link = screen.getByRole("link", {name:"Open preview in new tab"}); expect(link).toHaveAttribute("href","https://preview.example"); expect(link).toHaveAttribute("rel","noopener noreferrer");
  fireEvent.click(screen.getByRole("button",{name:"Reload preview"})); expect(screen.getByTitle("WebContainer Preview")).not.toBe(frame);
  expect(restart).not.toHaveBeenCalled(); expect(screen.getByText("Loading preview…")).toBeVisible();
});
it("provides recovery after timeout and resets the timeout for a new navigation", () => {
  vi.useFakeTimers(); const restart=vi.fn(); render(<PreviewFrame url="https://preview.example" onRestart={restart}/>);
  act(() => vi.advanceTimersByTime(PREVIEW_LOAD_TIMEOUT_MS)); expect(screen.getByRole("alert")).toHaveTextContent("did not finish loading");
  fireEvent.click(screen.getByRole("button",{name:"Restart runtime to recover preview"})); expect(restart).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button",{name:"Reload preview"})); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.load(screen.getByTitle("WebContainer Preview")); act(() => vi.advanceTimersByTime(PREVIEW_LOAD_TIMEOUT_MS)); expect(screen.getByText("Preview frame loaded")).toBeVisible();
});
it("handles iframe errors without discarding sibling drafts", () => {
  render(<><textarea aria-label="Draft" defaultValue="unsaved"/><PreviewFrame url="https://preview.example" onRestart={vi.fn()}/></>);
  fireEvent.error(screen.getByTitle("WebContainer Preview")); expect(screen.getByRole("alert")).toBeVisible(); expect(screen.getByLabelText("Draft")).toHaveValue("unsaved");
});
it("contains a runtime panel crash and retries without remounting the editor sibling", () => {
  const errors=vi.spyOn(console,"error").mockImplementation(()=>undefined); let crash=true;
  function Panel(){if(crash)throw new Error("display failed"); return <div>Panel recovered</div>;}
  render(<><textarea aria-label="Draft" defaultValue="unsaved"/><RuntimePanelBoundary><Panel/></RuntimePanelBoundary></>);
  const draft=screen.getByLabelText("Draft"); expect(screen.getByRole("alert")).toHaveTextContent("editor and drafts remain available");
  crash=false; fireEvent.click(screen.getByRole("button",{name:"Retry runtime panel"})); expect(screen.getByText("Panel recovered")).toBeVisible(); expect(screen.getByLabelText("Draft")).toBe(draft); errors.mockRestore();
});

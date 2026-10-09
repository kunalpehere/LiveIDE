// @vitest-environment jsdom
import React, { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TemplateFolder } from "@/features/playground/libs/path-to-json";
import { flushRuntime, runtimeFixture } from "./fixtures/webcontainer";

const mocks = vi.hoisted(() => ({ boot: vi.fn() }));
vi.mock("@/features/webcontainers/service/webContainerService", async importOriginal => {
  const actual = await importOriginal<typeof import("@/features/webcontainers/service/webContainerService")>();
  return { ...actual, default: new actual.WebContainerSessionService(mocks.boot) };
});
vi.mock("@/features/webcontainers/components/terminal", () => ({ default: () => <div>Test terminal</div> }));
import service from "@/features/webcontainers/service/webContainerService";
import { useWebContainer } from "@/features/webcontainers/hooks/useWebContainer";
import WebContainerPreview from "@/features/webcontainers/components/webcontainer-preview";

const template: TemplateFolder = { folderName: "Root", items: [{ filename: "package", fileExtension: "json", content: "{}" }] };
beforeEach(() => { service.teardown(); mocks.boot.mockReset(); });
afterEach(() => { cleanup(); service.teardown(); });

function Workspace() {
  const runtime = useWebContainer({ projectId: "a", templateData: template });
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={() => setVisible(previous => !previous)}>Toggle preview</button>
    <output data-testid="phase">{runtime.phase}</output>
    {visible && <WebContainerPreview {...runtime} onRetry={() => { void runtime.restart().catch(() => undefined); }} onStop={runtime.stop} />}
  </>;
}
it("does not boot a viewer runtime and rejects viewer terminal, restart and write operations", async () => {
  const runtime = runtimeFixture(); mocks.boot.mockResolvedValue(runtime.instance);
  const hook = renderHook(() => useWebContainer({ projectId: "a", templateData: template, canEdit: false }));
  await flushRuntime(); expect(mocks.boot).not.toHaveBeenCalled(); expect(hook.result.current.instance).toBeNull();
  await expect(hook.result.current.spawnProcess("sh")).rejects.toThrow("Viewers");
  await expect(hook.result.current.restart()).rejects.toThrow("Viewers");
  await expect(hook.result.current.writeFileSync("App.tsx", "write")).rejects.toThrow("Viewers");
  render(<WebContainerPreview {...hook.result.current} canEdit={false} onRetry={vi.fn()} onStop={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Stop runtime" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Restart runtime" })).toBeDisabled();
  expect(screen.queryByText("Test terminal")).not.toBeInTheDocument();
});

it("keeps the hook's lease and setup stable through Strict Mode and preview/terminal changes", async () => {
  const runtime = runtimeFixture();
  mocks.boot.mockResolvedValue(runtime.instance);
  render(<StrictMode><Workspace /></StrictMode>);
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Toggle preview" }));
  expect(screen.queryByText("Test terminal")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Toggle preview" }));
  expect(screen.getByText("Test terminal")).toBeInTheDocument();
  expect(mocks.boot).toHaveBeenCalledOnce();
  expect(runtime.instance.mount).toHaveBeenCalledOnce();
  expect(runtime.servers[0].process.kill).not.toHaveBeenCalled();
});

it("retries boot failure in place and delivers the new instance to the hook", async () => {
  const runtime = runtimeFixture();
  // acquire and setup share one attempt; both observe its failure.
  mocks.boot.mockRejectedValueOnce(new Error("Browser boot failed")).mockResolvedValue(runtime.instance);
  const { result } = renderHook(() => useWebContainer({ projectId: "a", templateData: template }));
  await waitFor(() => expect(result.current.phase).toBe("failed"));
  expect(result.current.instance).toBeNull();
  await act(async () => { await result.current.restart(); });
  expect(result.current.phase).toBe("ready");
  expect(result.current.instance).toBe(runtime.instance);
  expect(mocks.boot).toHaveBeenCalledTimes(2);
});

it("offers Retry, Stop, and Start without reloading the workspace", async () => {
  const runtime = runtimeFixture({ installExits: [Promise.resolve(1), Promise.resolve(0)] });
  mocks.boot.mockResolvedValue(runtime.instance);
  render(<Workspace />);
  await screen.findByRole("button", { name: "Retry runtime" });
  expect(screen.getByRole("alert")).toHaveTextContent("Dependency installation failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry runtime" }));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Stop runtime" }));
  expect(screen.getByTestId("phase")).toHaveTextContent("stopped");
  expect(screen.getByText("Your files remain available for editing.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Start runtime" }));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("ready"));
  expect(mocks.boot).toHaveBeenCalledOnce();
  expect(runtime.instance.mount).toHaveBeenCalledTimes(3);
  expect(runtime.installs).toHaveLength(2);
  expect(screen.getByTestId("runtime-startup")).toHaveTextContent("Dependencies reused: 0.00s");
});

it("cancels the previous project immediately and ignores its old hook callbacks", async () => {
  const first = runtimeFixture();
  const second = runtimeFixture();
  mocks.boot.mockResolvedValueOnce(first.instance).mockResolvedValue(second.instance);
  const { result, rerender } = renderHook(({ projectId, templateData }) => useWebContainer({ projectId, templateData }), {
    initialProps: { projectId: "a", templateData: template as TemplateFolder | null },
  });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  const oldRestart = result.current.restart;
  const oldStop = result.current.stop;
  rerender({ projectId: "b", templateData: null });
  await act(flushRuntime);
  expect(first.instance.teardown).toHaveBeenCalledOnce();
  rerender({ projectId: "b", templateData: template });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await act(async () => { await oldRestart(); oldStop(); });
  expect(service.getState()).toMatchObject({ projectId: "b", phase: "ready", instance: second.instance });
  expect(second.instance.mount).toHaveBeenCalledOnce();
});

it("does not let a save started before Stop automatically restart execution afterwards", async () => {
  const runtime = runtimeFixture();
  mocks.boot.mockResolvedValue(runtime.instance);
  const { result } = renderHook(() => useWebContainer({ projectId: "a", templateData: template }));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  const restartAfterSave = result.current.restart;
  act(() => result.current.stop());
  await act(async () => { await restartAfterSave(template, { onlyIfActive: true }); });
  expect(result.current.phase).toBe("stopped");
  expect(runtime.instance.mount).toHaveBeenCalledOnce();
  await act(async () => { await result.current.restart(); });
  expect(result.current.phase).toBe("ready");
});

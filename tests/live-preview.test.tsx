// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { draftTemplate, useLivePreview } from "@/features/webcontainers/hooks/useLivePreview";
import type { TemplateFolder } from "@/features/playground/libs/path-to-json";
import { deferred } from "./fixtures/webcontainer";

const template: TemplateFolder = { folderName: "Root", items: [
  { folderName: "src", items: [{ filename: "App", fileExtension: "tsx", content: "saved" }] },
  { filename: "package", fileExtension: "json", content: "{}" },
] };
const writeFile = vi.fn().mockResolvedValue(undefined);
const restart = vi.fn().mockResolvedValue(undefined);
const base = { projectId: "a", template, phase: "ready" as const, enabled: true, canEdit: true, writeFile, restart };
function draft(content: string, path = "src/App.tsx") {
  const [filename, fileExtension] = path.split("/").at(-1)!.split(".");
  const originalContent = path === "package.json" ? "{}" : "saved";
  useFileExplorer.getState().setOpenFiles([{ id: path, filename, fileExtension, content, originalContent, hasUnsavedChanges: content !== originalContent }]);
}
beforeEach(() => { vi.useFakeTimers(); writeFile.mockReset().mockResolvedValue(undefined); restart.mockReset().mockResolvedValue(undefined);
  useFileExplorer.setState({ playgroundId: "a", templateData: template, openFiles: [] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function pause() { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); }

it("coalesces drafts without saving or changing dirty state, and syncs a revert", async () => {
  renderHook(() => useLivePreview(base));
  act(() => draft("first")); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  act(() => draft("latest")); await pause();
  expect(writeFile.mock.calls).toEqual([["src/App.tsx", "latest"]]);
  expect(useFileExplorer.getState().openFiles[0]).toMatchObject({ originalContent: "saved", hasUnsavedChanges: true });
  act(() => draft("saved")); await pause();
  expect(writeFile).toHaveBeenLastCalledWith("src/App.tsx", "saved"); expect(restart).not.toHaveBeenCalled();
});
it("cancels pending synchronization on disabling, Stop, project switch and unmount", async () => {
  const { rerender, unmount } = renderHook(props => useLivePreview(props), { initialProps: { ...base, phase: "ready" as "ready" | "stopped" } });
  act(() => draft("draft")); rerender({ ...base, phase: "ready", enabled: false }); await pause();
  rerender({ ...base, phase: "stopped" }); await pause();
  rerender({ ...base, projectId: "b", phase: "ready" }); await pause();
  rerender({ ...base, phase: "ready" }); unmount(); await pause(); expect(writeFile).not.toHaveBeenCalled();
});
it("requires an explicit run for dependency drafts and leaves them unsaved", async () => {
  const { result } = renderHook(() => useLivePreview(base)); act(() => draft('{"dependencies":{"x":"1"}}', "package.json")); await pause();
  expect(writeFile).not.toHaveBeenCalled();
  await act(async () => { await result.current.run(); });
  expect(restart).toHaveBeenCalledOnce(); expect(restart.mock.calls[0][0].items[1].content).toContain('"x"');
  expect(useFileExplorer.getState().openFiles[0].hasUnsavedChanges).toBe(true);
});
it("Run syncs source drafts while ready, starts stopped drafts, and Restart is explicit", async () => {
  const { result, rerender } = renderHook(props => useLivePreview(props), { initialProps: { ...base, enabled: false, phase: "ready" as "ready" | "stopped" } });
  act(() => draft("run draft")); await act(async () => { await result.current.run(); });
  expect(writeFile).toHaveBeenCalledWith("src/App.tsx", "run draft"); expect(restart).not.toHaveBeenCalled();
  rerender({ ...base, enabled: false, phase: "stopped" }); await act(async () => { await result.current.run(); });
  expect(restart.mock.calls[0][0].items[0].items[0].content).toBe("run draft");
  rerender({ ...base, enabled: false, phase: "ready" }); await act(async () => { await result.current.run(true); }); expect(restart).toHaveBeenCalledTimes(2);
});
it("contains sync errors, retries with Run, and prevents viewer draft writes", async () => {
  writeFile.mockRejectedValueOnce(new Error("disk failed")); const { result, rerender } = renderHook(props => useLivePreview(props), { initialProps: base });
  act(() => draft("draft")); await pause(); expect(result.current.status).toBe("error");
  await act(async () => { await result.current.run(); }); expect(writeFile).toHaveBeenCalledTimes(2);
  rerender({ ...base, canEdit: false }); act(() => draft("viewer")); await pause(); await act(async () => { await result.current.run(); }); expect(writeFile).toHaveBeenCalledTimes(2);
});
it("does not continue an old project's write batch after a switch", async () => {
  const pending = deferred<void>(); writeFile.mockReturnValueOnce(pending.promise);
  const { rerender } = renderHook(props => useLivePreview(props), { initialProps: base }); act(() => draft("old")); await pause();
  rerender({ ...base, projectId: "b" }); await act(async () => pending.resolve()); await pause(); expect(writeFile).toHaveBeenCalledOnce();
});
it("overlays duplicate basenames by path without mutating saved templates", () => {
  const tree: TemplateFolder = { folderName: "Root", items: [template.items[0], { folderName: "other", items: [{ filename: "App", fileExtension: "tsx", content: "other saved" }] }] };
  draft("other draft", "other/App.tsx");
  const result = draftTemplate(tree, "a");
  expect((result.items[0] as TemplateFolder).items[0]).toMatchObject({content:"saved"});
  expect((result.items[1] as TemplateFolder).items[0]).toMatchObject({content:"other draft"});
  expect((tree.items[1] as TemplateFolder).items[0]).toMatchObject({content:"other saved"}); expect(draftTemplate(tree, "b")).toEqual(tree);
});

it("tracks the mounted draft baseline after Stop/Run so reverting or closing reaches the runtime", async () => {
  const { result, rerender } = renderHook(props => useLivePreview(props), { initialProps: {...base, enabled:false, phase:"stopped" as "ready" | "stopped"} });
  act(() => draft("mounted draft")); await act(async () => { await result.current.run(); });
  rerender({...base, enabled:false, phase:"ready"});
  act(() => draft("saved")); await act(async () => { await result.current.run(); });
  expect(writeFile).toHaveBeenLastCalledWith("src/App.tsx", "saved");
  rerender({...base, enabled:true, phase:"ready"}); act(() => draft("previewed")); await pause();
  act(() => useFileExplorer.getState().setOpenFiles([])); await pause();
  expect(writeFile).toHaveBeenLastCalledWith("src/App.tsx", "saved");
});

it("preserves other previewed drafts when a source Save changes the template reference", async () => {
  const withOther: TemplateFolder = {...template, items:[...template.items, {filename:"other", fileExtension:"txt", content:"before"}]};
  const { rerender } = renderHook(props => useLivePreview(props), {initialProps:{...base, template:withOther}});
  act(() => draft("previewed")); await pause();
  const savedOther: TemplateFolder = {...withOther, items:[...template.items, {filename:"other", fileExtension:"txt", content:"after"}]};
  rerender({...base, template:savedOther});
  act(() => useFileExplorer.getState().setOpenFiles([])); await pause();
  expect(writeFile.mock.calls.filter(([path]) => path === "src/App.tsx")).toEqual([["src/App.tsx", "previewed"], ["src/App.tsx", "saved"]]);
});

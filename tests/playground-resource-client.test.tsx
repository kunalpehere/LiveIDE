// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/features/playground/actions", () => ({ getPlaygroundById: mocks.load, SaveUpdatedCode: mocks.save }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
import { usePlayground } from "@/features/playground/hooks/usePlayground";
const content = { folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: "saved content" }] };
describe("project loading and resource feedback", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([content, JSON.stringify(content)])("loads persisted JSON objects and serialized trees without replacing them with a starter", async saved => {
    mocks.load.mockResolvedValue({ id: "project", title: "Project", template: "REACT", accessRole: "OWNER", templateFiles: [{ content: saved, version: 4 }] });
    const hook = renderHook(() => usePlayground("project"));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.templateData).toEqual(content);
    mocks.save.mockResolvedValue({ success: true, data: { version: 5 } });
    await act(async () => hook.result.current.saveTemplateData(content));
    expect(mocks.save).toHaveBeenCalledWith("project", content, 4);
  });
  it("keeps oversized legacy content readable", async () => {
    const legacy = { folderName: "Root", items: [{ filename: "large", fileExtension: "txt", content: "x".repeat(256 * 1024 + 1) }] };
    mocks.load.mockResolvedValue({ id: "project", template: "REACT", accessRole: "OWNER", templateFiles: [{ content: legacy, version: 1 }] });
    const hook = renderHook(() => usePlayground("project"));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.templateData).toEqual(legacy);
    await act(async () => {
      await expect(hook.result.current.saveTemplateData(legacy)).rejects.toThrow(/256 KiB/);
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Reduce"));
    expect(hook.result.current.templateData).toEqual(legacy);
  });
});

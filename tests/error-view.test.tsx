// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorView } from "@/components/error-view";

describe("ErrorView", () => {
  it("shows a safe message and invokes retry", () => {
    const reset = vi.fn();
    render(<ErrorView title="Playground unavailable" message="Retry safely." reset={reset} />);
    expect(screen.getByRole("heading", { name: "Playground unavailable" })).toBeVisible();
    expect(screen.getByText("Retry safely.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

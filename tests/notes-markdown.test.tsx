// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NotesMarkdown, notesUrl, NOTES_PREVIEW_LIMIT } from "@/features/playground/components/notes-markdown";
afterEach(cleanup);
it("renders Markdown while dropping executable HTML, unsafe links, and remote images", () => {
  const { container } = render(<NotesMarkdown text={'# Plan\n\n**Shared**\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n[Unsafe](javascript:alert(1))\n\n[Safe](https://example.com)\n\n![tracking](https://evil.example/pixel.png)'} />);
  expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  expect(container.querySelector("strong")?.textContent).toBe("Shared");
  expect(container.querySelector("script, iframe, img")).toBeNull();
  expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
  expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute("rel", "noopener noreferrer");
});
it("rejects unsafe and obfuscated URL schemes", () => {
  for (const url of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,evil", "vbscript:evil", "file:///etc/passwd"]) expect(notesUrl(url)).toBe("");
  expect(notesUrl("/dashboard")).toBe("/dashboard"); expect(notesUrl("mailto:user@example.com")).toBe("mailto:user@example.com");
});
it("bounds preview rendering without modifying the notes", () => {
  const text = "x".repeat(NOTES_PREVIEW_LIMIT + 1);
  render(<NotesMarkdown text={text} />);
  expect(screen.getByRole("status")).toHaveTextContent("Preview shows the first");
  expect(text.length).toBe(NOTES_PREVIEW_LIMIT + 1);
});

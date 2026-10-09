"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const NOTES_PREVIEW_LIMIT = 100_000;
export function notesUrl(url: string) {
  try {
    const parsed = new URL(url, "https://liveide.invalid");
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? url : "";
  } catch { return ""; }
}
export function NotesMarkdown({ text }: { text: string }) {
  return <div className="space-y-3 break-words text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3">
    {text.length > NOTES_PREVIEW_LIMIT && <p role="status">Preview shows the first {NOTES_PREVIEW_LIMIT.toLocaleString()} characters. The full notes remain in the editor.</p>}
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={notesUrl} components={{
      a: ({ href, children }) => href ? <a className="underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="text-muted-foreground">[Image: {alt || "image"}]</span>,
    }}>{text.slice(0, NOTES_PREVIEW_LIMIT) || "No project notes yet."}</ReactMarkdown>
  </div>;
}

"use client";

import { useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useCollaborativeNotes } from "../hooks/useCollaborativeNotes";
import { NotesMarkdown } from "./notes-markdown";

if (typeof window !== "undefined") {
  const configuration = { paths: { vs: new URL("/monaco/vs", window.location.origin).href }, preferScriptTags: true };
  loader.config(configuration);
}

export default function ProjectNotes({ playgroundId, enabled, canEdit, open, onClose }: {
  playgroundId: string; enabled: boolean; canEdit: boolean; open: boolean; onClose: () => void;
}) {
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [preview, setPreview] = useState(false);
  const { resolvedTheme } = useTheme();
  const notes = useCollaborativeNotes({ playgroundId, enabled, canEdit, editorInstance });
  return <aside aria-label="Project notes" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); }
  }} className={`${open ? "flex" : "hidden"} fixed bottom-0 right-0 top-14 z-40 w-full max-w-lg flex-col border-l bg-background shadow-xl`}>
    <header className="flex items-center justify-between border-b p-4"><h2 className="font-semibold">Project notes</h2><Button size="sm" variant="ghost" onClick={onClose} aria-label="Close notes">Close</Button></header>
    {!enabled ? <p className="p-4 text-sm" role="status">Shared notes are unavailable because collaboration is not configured.</p> : <>
      <div className="space-y-2 border-b p-3">
        <p className="text-xs text-muted-foreground">Shared Markdown notes. Source files, snapshots, and runtime stay separate.</p>
        <p className="text-xs" role="status">Notes: {notes.status}{!canEdit && " · read-only"}</p>
        {notes.message && <p className="text-xs" role="status">{notes.message}</p>}
        {notes.status === "connected" && <p className="text-xs text-muted-foreground">Shared live. The service checkpoints changes automatically.</p>}
        {notes.status === "failed" && <Button size="sm" variant="outline" onClick={notes.retry}>Retry notes connection</Button>}
        <div className="flex gap-2"><Button size="sm" variant={!preview ? "secondary" : "outline"} aria-pressed={!preview} onClick={() => setPreview(false)}>Edit notes</Button><Button size="sm" variant={preview ? "secondary" : "outline"} aria-pressed={preview} onClick={() => setPreview(true)}>Preview notes</Button></div>
      </div>
      {/* Keep the binding alive across panel/preview toggles and file switches. */}
      <div className={`${preview ? "hidden" : "block"} min-h-0 flex-1`}>
        <Editor height="100%" path={`liveide-notes:///${encodeURIComponent(playgroundId)}/notes.md`} defaultLanguage="markdown" defaultValue="" theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
          onMount={instance => setEditorInstance(instance)} options={{ readOnly: !notes.editable, ariaLabel: "Shared project notes", automaticLayout: true, wordWrap: "on", minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }} />
      </div>
      {preview && <div className="min-h-0 flex-1 overflow-auto p-4" aria-label="Notes preview"><NotesMarkdown text={notes.text} /></div>}
    </>}
  </aside>;
}

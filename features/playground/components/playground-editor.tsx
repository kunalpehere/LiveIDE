"use client"

import { useRef, useEffect, useCallback, useState, useMemo } from "react"
import Editor, { loader, type Monaco } from "@monaco-editor/react"
import { configureMonaco, defaultEditorOptions, getEditorLanguage } from "@/features/playground/libs/editor-config"
import type { TemplateFile } from "@/features/playground/libs/path-to-json"
import type { CancellationToken, IDisposable, Position, editor, languages } from "monaco-editor"
import { useCollaborativeEditor } from "@/features/playground/hooks/useCollaborativeEditor"
import { Users } from "lucide-react"
import { CollaborationDiagnostics } from "./collaboration-diagnostics"
import { useFollowCollaborator } from "../hooks/useFollowCollaborator"

type CodeEditor = editor.IStandaloneCodeEditor

// Forward the AMD loader option so it uses script tags rather than eval.
if (typeof window !== "undefined") {
  // Blob workers need an absolute base URL when resolving language workers.
  const monacoLoaderConfiguration = { paths: { vs: new URL("/monaco/vs", window.location.origin).href }, preferScriptTags: true };
  loader.config(monacoLoaderConfiguration);
}

interface PlaygroundEditorProps {
  readOnly?: boolean
  collaborationEnabled?: boolean
  playgroundId?: string
  filePath?: string
  activeFile: TemplateFile | undefined
  content: string
  onContentChange: (value: string) => void
  suggestion: string | null
  suggestionLoading: boolean
  suggestionPosition: { line: number; column: number } | null
  onAcceptSuggestion: (editor: CodeEditor, monaco: Monaco) => void
  onRejectSuggestion: (editor: CodeEditor) => void
  onTriggerSuggestion: (type: string, editor: CodeEditor) => void
}

export const PlaygroundEditor = ({
  readOnly = false,
  collaborationEnabled = false,
  playgroundId,
  filePath,
  activeFile,
  content,
  onContentChange,
  suggestion,
  suggestionLoading,
  suggestionPosition,
  onAcceptSuggestion,
  onRejectSuggestion,
  onTriggerSuggestion,
}: PlaygroundEditorProps) => {
  const editorRef = useRef<CodeEditor | null>(null)
  const [editorInstance, setEditorInstance] = useState<CodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const inlineCompletionProviderRef = useRef<IDisposable | null>(null)
  const editorListenersRef = useRef<IDisposable[]>([])
  const ownedModelsRef = useRef(new Set<editor.ITextModel>())
  const options = useMemo(() => ({ ...defaultEditorOptions, readOnly }), [readOnly])
  const handleContentChange = useCallback((value: string | undefined) => {
    if (!readOnly) onContentChange(value || "")
  }, [readOnly, onContentChange])
  const fileExtension = activeFile?.fileExtension || ""
  const modelPath = `liveide:///${encodeURIComponent(playgroundId || "local")}/${(filePath || `${activeFile?.filename || "untitled"}.${fileExtension}`).split("/").map(encodeURIComponent).join("/")}`
  const currentSuggestionRef = useRef<{
    text: string
    position: { line: number; column: number }
    id: string
  } | null>(null)
  const isAcceptingSuggestionRef = useRef(false)
  const suggestionAcceptedRef = useRef(false)
  const suggestionVisibleContextRef = useRef<editor.IContextKey<boolean> | null>(null)
  const onTriggerSuggestionRef = useRef(onTriggerSuggestion)
  const collaboration = useCollaborativeEditor({
    enabled: collaborationEnabled,
    playgroundId,
    filePath,
    editorInstance,
  })
  const follow = useFollowCollaborator({ enabled: collaborationEnabled, playgroundId, filePath, editorInstance })

  // Generate unique ID for each suggestion
  const generateSuggestionId = () => `suggestion-${Date.now()}-${Math.random()}`

  // Create inline completion provider
  const createInlineCompletionProvider = useCallback(
    (monaco: Monaco) => {
      return {
        provideInlineCompletions: async (_model: editor.ITextModel, position: Position, _context: languages.InlineCompletionContext, _token: CancellationToken) => {
          // Don't provide completions if we're currently accepting or have already accepted
          if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current) {
            return { items: [] }
          }

          // Only provide suggestion if we have one
          if (!suggestion || !suggestionPosition) {
            return { items: [] }
          }

          // Check if current position matches suggestion position (with some tolerance)
          const currentLine = position.lineNumber
          const currentColumn = position.column

          const isPositionMatch =
            currentLine === suggestionPosition.line &&
            currentColumn >= suggestionPosition.column &&
            currentColumn <= suggestionPosition.column + 2 // Small tolerance

          if (!isPositionMatch) {
            return { items: [] }
          }

          const suggestionId = generateSuggestionId()
          currentSuggestionRef.current = {
            text: suggestion,
            position: suggestionPosition,
            id: suggestionId,
          }

          // Clean the suggestion text (remove \r characters)
          const cleanSuggestion = suggestion.replace(/\r/g, "")

          return {
            items: [
              {
                insertText: cleanSuggestion,
                range: new monaco.Range(
                  suggestionPosition.line,
                  suggestionPosition.column,
                  suggestionPosition.line,
                  suggestionPosition.column,
                ),
                kind: monaco.languages.CompletionItemKind.Snippet,
                label: "AI Suggestion",
                detail: "AI-generated code suggestion",
                documentation: "Press Tab to accept",
                sortText: "0000", // High priority
                filterText: "",
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              },
            ],
          }
        },
        freeInlineCompletions: (_completions: languages.InlineCompletions) => {},
      }
    },
    [suggestion, suggestionPosition],
  )

  // Clear current suggestion
  const clearCurrentSuggestion = useCallback(() => {
    currentSuggestionRef.current = null
    suggestionAcceptedRef.current = false
    suggestionVisibleContextRef.current?.set(false)
    if (editorRef.current) {
      editorRef.current.trigger("ai", "editor.action.inlineSuggest.hide", null)
    }
  }, [])

  // Accept current suggestion with double-acceptance prevention
  const acceptCurrentSuggestion = useCallback(() => {
    if (!editorRef.current || !monacoRef.current || !currentSuggestionRef.current) {
      return false
    }

    if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current) {
      return false
    }

    isAcceptingSuggestionRef.current = true
    suggestionAcceptedRef.current = true

    const editor = editorRef.current
    const monaco = monacoRef.current
    try {
      // Get current cursor position to validate
      const currentPosition = editor.getPosition()
      const suggestionPos = currentSuggestionRef.current.position
      if (!currentPosition) return false

      // Verify we're still at the suggestion position
      if (
        currentPosition.lineNumber !== suggestionPos.line ||
        currentPosition.column < suggestionPos.column ||
        currentPosition.column > suggestionPos.column + 5
      ) {
        return false
      }

      // The hook owns the edit. Keeping one insertion path prevents duplicate text.
      onAcceptSuggestion(editor, monaco)
      clearCurrentSuggestion()

      return true
    } catch (error) {
      console.error("Error accepting suggestion:", error)
      return false
    } finally {
      // Reset accepting flag immediately
      isAcceptingSuggestionRef.current = false

      // Keep accepted flag for longer to prevent immediate re-acceptance
      setTimeout(() => {
        suggestionAcceptedRef.current = false
      }, 1000)
    }
  }, [clearCurrentSuggestion, onAcceptSuggestion])

  useEffect(() => {
    onTriggerSuggestionRef.current = onTriggerSuggestion
  }, [onTriggerSuggestion])

  // Check if there's an active inline suggestion at current position
  const hasActiveSuggestionAtPosition = useCallback(() => {
    if (!editorRef.current || !currentSuggestionRef.current) return false

    const position = editorRef.current.getPosition()
    const suggestion = currentSuggestionRef.current
    if (!position) return false

    return (
      position.lineNumber === suggestion.position.line &&
      position.column >= suggestion.position.column &&
      position.column <= suggestion.position.column + 2
    )
  }, [])

  // Update inline completions when suggestion changes
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const editor = editorRef.current
    const monaco = monacoRef.current

    // Don't update if we're in the middle of accepting a suggestion
    if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current) {
      return
    }

    // Dispose previous provider
    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose()
      inlineCompletionProviderRef.current = null
    }

    // Clear current suggestion reference
    currentSuggestionRef.current = null
    suggestionVisibleContextRef.current?.set(false)

    // Register new provider if we have a suggestion
    if (suggestion && suggestionPosition) {
      currentSuggestionRef.current = { text: suggestion, position: suggestionPosition, id: generateSuggestionId() }
      suggestionVisibleContextRef.current?.set(true)
      const language = getEditorLanguage(fileExtension)
      const provider = createInlineCompletionProvider(monaco)

      inlineCompletionProviderRef.current = monaco.languages.registerInlineCompletionsProvider(language, provider)

      // Small delay to ensure editor is ready, then trigger suggestions
      setTimeout(() => {
        if (editorRef.current && !isAcceptingSuggestionRef.current && !suggestionAcceptedRef.current) {
          editor.trigger("ai", "editor.action.inlineSuggest.trigger", null)
        }
      }, 50)
    }

    return () => {
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
        inlineCompletionProviderRef.current = null
      }
    }
  }, [suggestion, suggestionPosition, fileExtension, createInlineCompletionProvider])

  const handleEditorDidMount = (editor: CodeEditor, monaco: Monaco) => {
    editorListenersRef.current.forEach(listener => listener.dispose());
    editorListenersRef.current = [];
    // Safety check to ensure editor and monaco are properly initialized
    if (!editor || !monaco) {
      console.warn("Editor or Monaco not properly initialized")
      return
    }
    
    editorRef.current = editor
    const rememberModel = () => {
      const model = editor.getModel()
      if (model) ownedModelsRef.current.add(model)
    }
    rememberModel()
    editorListenersRef.current.push(editor.onDidChangeModel(rememberModel))
    setEditorInstance(editor)
    monacoRef.current = monaco
    suggestionVisibleContextRef.current = editor.createContextKey("liveideAiSuggestionVisible", false)
    if (editor && typeof editor.updateOptions === 'function') {
      editor.updateOptions({
        ...defaultEditorOptions,
        // Enable inline suggestions but with specific settings to prevent conflicts
        inlineSuggest: {
          enabled: true,
          mode: "prefix",
          suppressSuggestions: false,
        },
        // Disable some conflicting suggest features
        suggest: {
          preview: false, // Disable preview to avoid conflicts
          showInlineDetails: false,
          insertMode: "replace",
        },
        // Quick suggestions
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        // Smooth cursor
        cursorSmoothCaretAnimation: "on",
      })
    }

    if (typeof configureMonaco === 'function') {
      configureMonaco(monaco)
    }

    // Keyboard shortcuts
    if (editor && typeof editor.addCommand === 'function') {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
        onTriggerSuggestionRef.current("completion", editor)
      })
    }

    // Override Tab while an inline completion is active.
    if (editor && typeof editor.addCommand === 'function') {
      editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        if (isAcceptingSuggestionRef.current) {
          return
        }

        // If we have an active suggestion at the current position, try to accept it
        if (currentSuggestionRef.current && typeof hasActiveSuggestionAtPosition === 'function' && hasActiveSuggestionAtPosition()) {
          if (typeof acceptCurrentSuggestion === 'function') {
            const accepted = acceptCurrentSuggestion()
            if (accepted) {
              return
            }
          }
        }

      },
      "editorTextFocus && !editorReadonly && liveideAiSuggestionVisible",
    )
    } else {
      console.warn("Editor addCommand method not available")
    }

    // Escape to reject
    if (editor && typeof editor.addCommand === 'function') {
      editor.addCommand(monaco.KeyCode.Escape, () => {
        if (currentSuggestionRef.current) {
          if (typeof onRejectSuggestion === 'function') {
            onRejectSuggestion(editor)
          }
          if (typeof clearCurrentSuggestion === 'function') {
            clearCurrentSuggestion()
          }
        }
      })
    }

    // Listen for cursor position changes to hide suggestions when moving away
    if (editor && typeof editor.onDidChangeCursorPosition === 'function') {
      editorListenersRef.current.push(editor.onDidChangeCursorPosition((e: editor.ICursorPositionChangedEvent) => {
        if (isAcceptingSuggestionRef.current) return

      const newPosition = e.position

      // Clear existing suggestion if cursor moved away
      if (currentSuggestionRef.current && !suggestionAcceptedRef.current) {
        const suggestionPos = currentSuggestionRef.current.position

        // If cursor moved away from suggestion position, clear it
        if (
          newPosition.lineNumber !== suggestionPos.line ||
          newPosition.column < suggestionPos.column ||
          newPosition.column > suggestionPos.column + 10
        ) {
          if (typeof clearCurrentSuggestion === 'function') {
            clearCurrentSuggestion()
          }
          if (typeof onRejectSuggestion === 'function') {
            onRejectSuggestion(editor)
          }
        }
      }

    }))
    }

    // Listen for content changes to detect manual typing over suggestions
    if (editor && typeof editor.onDidChangeModelContent === 'function') {
      editorListenersRef.current.push(editor.onDidChangeModelContent((e: editor.IModelContentChangedEvent) => {
      if (isAcceptingSuggestionRef.current) return

      // If user types while there's a suggestion, clear it (unless it's our insertion)
      if (currentSuggestionRef.current && e.changes.length > 0 && !suggestionAcceptedRef.current) {
        const change = e.changes[0]

        // Check if this is our own suggestion insertion
        if (
          change.text === currentSuggestionRef.current.text ||
          change.text === currentSuggestionRef.current.text.replace(/\r/g, "")
        ) {
          return
        }

        // User typed something else, clear the suggestion
        if (typeof clearCurrentSuggestion === 'function') {
          clearCurrentSuggestion()
        }
      }

    }))
    }

    if (typeof updateEditorLanguage === 'function') {
      updateEditorLanguage()
    }
  }

  const updateEditorLanguage = useCallback(() => {
    if (!fileExtension || !monacoRef.current || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return

    const language = getEditorLanguage(fileExtension)
    try {
      monacoRef.current.editor.setModelLanguage(model, language)
    } catch (error) {
      console.warn("Failed to set editor language:", error)
    }
  }, [fileExtension])

  useEffect(() => {
    updateEditorLanguage()
  }, [updateEditorLanguage])

  // Cleanup on unmount
  useEffect(() => {
    const ownedModels = ownedModelsRef.current
    return () => {
      editorListenersRef.current.forEach(listener => listener.dispose());
      editorListenersRef.current = [];
      // The React Monaco wrapper disposes the attached model. We own the
      // inactive models retained for tab undo/cursor history.
      const currentModel = editorRef.current?.getModel()
      ownedModels.forEach(model => {
        if (model !== currentModel && !model.isDisposed()) model.dispose()
      })
      ownedModels.clear()
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
        inlineCompletionProviderRef.current = null
      }
      suggestionVisibleContextRef.current = null
    }
  }, [])

  return (
    <div className="h-full relative flex flex-col">
      {collaborationEnabled && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 text-xs" aria-label="Collaborator follow controls">
          {follow.following !== null ? <>
            <span role="status">Following {follow.participants.find(peer => peer.clientId === follow.following)?.user.name || "collaborator"}</span>
            <button type="button" className="underline" onClick={follow.stop}>Stop following</button>
          </> : <>
            <label htmlFor="follow-collaborator">Follow collaborator</label>
            <select id="follow-collaborator" aria-label="Follow collaborator" value="" disabled={follow.status !== "connected"} onChange={event => { if (event.target.value) follow.follow(Number(event.target.value)); }} className="max-w-48 rounded border bg-background">
              <option value="">{follow.status === "connected" ? follow.participants.length ? "Choose participant" : "Nobody else online" : follow.status}</option>
              {follow.participants.map(peer => <option key={peer.clientId} value={peer.clientId} disabled={!peer.view || peer.following !== null}>{peer.user.name} · {peer.view?.filePath || "No file open"}</option>)}
            </select>
            {follow.status === "failed" && <button type="button" className="underline" onClick={follow.retry}>Retry presence</button>}
          </>}
          {follow.message && <span role="status">{follow.message}</span>}
        </div>
      )}
      {process.env.NODE_ENV === "development" && <CollaborationDiagnostics playgroundId={playgroundId} status={collaboration.status} getSnapshot={collaboration.getDiagnostics} />}
      {collaboration.status !== "disabled" && (
        <div className="absolute bottom-3 right-5 z-10 flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-xs shadow-sm">
          <span className={`h-2 w-2 rounded-full ${collaboration.status === "connected" ? "bg-green-500" : collaboration.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
          <Users className="h-3 w-3" />
          {collaboration.status === "connected" ? `${collaboration.participantCount} online` : collaboration.errorMessage || collaboration.status}
          {collaboration.status === "failed" && <button type="button" onClick={collaboration.retry} className="ml-2 underline">Retry collaboration</button>}
        </div>
      )}
      {/* Loading indicator */}
      {suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-red-100 dark:bg-red-900 px-2 py-1 rounded text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          Requesting completion…
        </div>
      )}

      {/* Active suggestion indicator */}
      {currentSuggestionRef.current && !suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-green-100 dark:bg-green-900 px-2 py-1 rounded text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          Press Tab to accept
        </div>
      )}

      <div className="min-h-0 flex-1">
      <Editor
        height="100%"
        path={modelPath}
        saveViewState
        defaultValue={content}
        // The wrapper calls setValue on every read-only value update, even
        // when equal. Let the CRDT binding own viewer updates to avoid echoes.
        value={readOnly && collaborationEnabled ? undefined : content}
        onChange={handleContentChange}
        onMount={handleEditorDidMount}
        language={activeFile ? getEditorLanguage(activeFile.fileExtension || "") : "plaintext"}
        options={options}
      />
      </div>
    </div>
  )
}

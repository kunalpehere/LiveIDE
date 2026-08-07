"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import Editor, { type Monaco } from "@monaco-editor/react"
import { configureMonaco, defaultEditorOptions, getEditorLanguage } from "@/features/playground/libs/editor-config"
import type { TemplateFile } from "@/features/playground/libs/path-to-json"
import type { CancellationToken, IDisposable, Position, editor, languages } from "monaco-editor"
import { useCollaborativeEditor } from "@/features/playground/hooks/useCollaborativeEditor"
import { Users } from "lucide-react"

type CodeEditor = editor.IStandaloneCodeEditor

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
    enabled: collaborationEnabled && !readOnly,
    playgroundId,
    filePath,
    initialContent: content,
    editorInstance,
  })

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
      const language = getEditorLanguage(activeFile?.fileExtension || "")
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
  }, [suggestion, suggestionPosition, activeFile, createInlineCompletionProvider])

  const handleEditorDidMount = (editor: CodeEditor, monaco: Monaco) => {
    // Safety check to ensure editor and monaco are properly initialized
    if (!editor || !monaco) {
      console.warn("Editor or Monaco not properly initialized")
      return
    }
    
    editorRef.current = editor
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
      editor.onDidChangeCursorPosition((e: editor.ICursorPositionChangedEvent) => {
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

    })
    }

    // Listen for content changes to detect manual typing over suggestions
    if (editor && typeof editor.onDidChangeModelContent === 'function') {
      editor.onDidChangeModelContent((e: editor.IModelContentChangedEvent) => {
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

    })
    }

    if (typeof updateEditorLanguage === 'function') {
      updateEditorLanguage()
    }
  }

  const updateEditorLanguage = useCallback(() => {
    if (!activeFile || !monacoRef.current || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return

    const language = getEditorLanguage(activeFile.fileExtension || "")
    try {
      monacoRef.current.editor.setModelLanguage(model, language)
    } catch (error) {
      console.warn("Failed to set editor language:", error)
    }
  }, [activeFile])

  useEffect(() => {
    updateEditorLanguage()
  }, [updateEditorLanguage])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
        inlineCompletionProviderRef.current = null
      }
      suggestionVisibleContextRef.current = null
    }
  }, [])

  return (
    <div className="h-full relative">
      {collaboration.status !== "disabled" && (
        <div className="absolute bottom-3 right-5 z-10 flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-xs shadow-sm">
          <span className={`h-2 w-2 rounded-full ${collaboration.status === "connected" ? "bg-green-500" : collaboration.status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
          <Users className="h-3 w-3" />
          {collaboration.status === "connected" ? `${collaboration.participantCount} online` : collaboration.status}
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

      <Editor
        height="100%"
        value={content}
        onChange={(value) => { if (!readOnly) onContentChange(value || "") }}
        onMount={handleEditorDidMount}
        language={activeFile ? getEditorLanguage(activeFile.fileExtension || "") : "plaintext"}
        options={{ ...defaultEditorOptions, readOnly }}
      />
    </div>
  )
}

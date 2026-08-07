import { useCallback, useEffect, useRef, useState } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type CodeEditor = editor.IStandaloneCodeEditor;
export type AIAvailability = "checking" | "ready" | "not-configured" | "unavailable";

interface AISuggestionsState {
  suggestion: string | null;
  isLoading: boolean;
  position: { line: number; column: number } | null;
  decoration: string[];
  isEnabled: boolean;
  availability: AIAvailability;
  error: string | null;
  provider: string | null;
  model: string | null;
}

interface UseAISuggestionsReturn extends AISuggestionsState {
  toggleEnabled: () => void;
  fetchSuggestion: (type: string, editor: CodeEditor) => Promise<void>;
  acceptSuggestion: (editor: CodeEditor, monaco: Monaco) => void;
  rejectSuggestion: (editor: CodeEditor) => void;
  clearSuggestion: (editor: CodeEditor) => void;
}

interface ErrorPayload { error?: { code?: string; message?: string } }

export const useAISuggestions = (): UseAISuggestionsReturn => {
  const [state, setState] = useState<AISuggestionsState>({
    suggestion: null,
    isLoading: false,
    position: null,
    decoration: [],
    isEnabled: false,
    availability: "checking",
    error: null,
    provider: null,
    model: null,
  });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/code-suggestion", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI configuration could not be checked.");
        return response.json() as Promise<{ configured: boolean; provider: string; model: string }>;
      })
      .then((configuration) => setState((previous) => ({
        ...previous,
        availability: configuration.configured ? "ready" : "not-configured",
        provider: configuration.provider,
        model: configuration.model,
        error: configuration.configured ? null : "Provider not configured. Set AI_ENABLED=true after starting your AI provider.",
      })))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((previous) => ({ ...previous, availability: "unavailable", error: "AI configuration is unavailable." }));
      });
    return () => controller.abort();
  }, []);

  const toggleEnabled = useCallback(() => {
    setState((previous) => {
      if (previous.availability !== "ready") {
        return { ...previous, isEnabled: false, error: previous.availability === "checking"
          ? "Checking AI configuration…"
          : "Provider not configured. Set AI_ENABLED=true after starting your AI provider." };
      }
      return { ...previous, isEnabled: !previous.isEnabled, suggestion: null, position: null, error: null };
    });
  }, []);

  const fetchSuggestion = useCallback(async (type: string, codeEditor: CodeEditor) => {
    const current = stateRef.current;
    if (!current.isEnabled || current.availability !== "ready" || current.isLoading) return;
    const model = codeEditor.getModel();
    const cursorPosition = codeEditor.getPosition();
    if (!model || !cursorPosition) return;

    setState((previous) => ({ ...previous, isLoading: true, error: null, suggestion: null, position: null }));
    try {
      const response = await fetch("/api/code-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent: model.getValue(),
          cursorLine: cursorPosition.lineNumber - 1,
          cursorColumn: cursorPosition.column - 1,
          suggestionType: type,
          fileName: model.uri.path.split("/").pop(),
        }),
      });
      const payload = await response.json() as { suggestion?: string } & ErrorPayload;
      if (!response.ok) {
        const notConfigured = payload.error?.code === "AI_NOT_CONFIGURED";
        setState((previous) => ({ ...previous, isLoading: false, isEnabled: notConfigured ? false : previous.isEnabled,
          availability: notConfigured ? "not-configured" : "unavailable",
          error: payload.error?.message || "AI provider is unavailable." }));
        return;
      }
      const suggestion = payload.suggestion?.trim();
      setState((previous) => ({ ...previous, suggestion: suggestion || null,
        position: suggestion ? { line: cursorPosition.lineNumber, column: cursorPosition.column } : null,
        isLoading: false, error: suggestion ? null : "The provider returned no suggestion." }));
    } catch {
      setState((previous) => ({ ...previous, isLoading: false, availability: "unavailable", error: "AI provider is unavailable." }));
    }
  }, []);

  const acceptSuggestion = useCallback((codeEditor: CodeEditor, monaco: Monaco) => {
    setState((current) => {
      if (!current.suggestion || !current.position) return current;
      const { line, column } = current.position;
      codeEditor.executeEdits("ai-suggestion-accept", [{
        range: new monaco.Range(line, column, line, column),
        text: current.suggestion.replace(/^\d+:\s*/gm, ""), forceMoveMarkers: true,
      }]);
      if (current.decoration.length) codeEditor.deltaDecorations(current.decoration, []);
      return { ...current, suggestion: null, position: null, decoration: [] };
    });
  }, []);

  const clearSuggestion = useCallback((codeEditor: CodeEditor) => {
    setState((current) => {
      if (current.decoration.length) codeEditor.deltaDecorations(current.decoration, []);
      return { ...current, suggestion: null, position: null, decoration: [] };
    });
  }, []);

  return { ...state, toggleEnabled, fetchSuggestion, acceptSuggestion,
    rejectSuggestion: clearSuggestion, clearSuggestion };
};

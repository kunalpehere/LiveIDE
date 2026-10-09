import type { editor, IDisposable } from "monaco-editor";

/** Own the cursor resources y-monaco 0.1 does not dispose itself. */
export function createPresenceEditor(target: editor.IStandaloneCodeEditor) {
  const listeners: IDisposable[] = [];
  let decorations: string[] = [];
  let decorating = false;
  const wrapped = new Proxy(target, {
    get(object, property) {
      if (property === "onDidChangeCursorSelection") return (...args: Parameters<typeof target.onDidChangeCursorSelection>) => {
        const [callback, thisArgs] = args;
        const listener = target.onDidChangeCursorSelection(event => {
          // Decoration changes can synchronously move the cursor. Publishing
          // that transient move would recursively render awareness decorations.
          if (!decorating) callback.call(thisArgs, event);
        });
        listeners.push(listener); return listener;
      };
      if (property === "deltaDecorations") return (...args: Parameters<typeof target.deltaDecorations>) => {
        decorating = true;
        try { decorations = target.deltaDecorations(...args); return decorations; }
        finally { decorating = false; }
      };
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return { editor: wrapped, dispose: () => {
    listeners.splice(0).forEach(listener => listener.dispose());
    const model = target.getModel();
    if (decorations.length && model && !model.isDisposed()) target.deltaDecorations(decorations, []);
    decorations = [];
  } };
}

"use client";

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import type { SpawnOptions, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Copy, Trash2, Download, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { waitForOperation } from "../service/runtime-operation";
import { consumeProcessOutput } from "../service/process-output";
import { TerminalOutputQueue, TERMINAL_SCROLLBACK, TERMINAL_HISTORY_LIMIT, TERMINAL_INPUT_LIMIT } from "../service/terminal-output";

interface TerminalProps {
  webcontainerUrl?: string;
  className?: string;
  theme?: "dark" | "light";
  webContainerInstance?: WebContainer | null;
  runtimeReady?: boolean;
  spawnProcess?: (command: string, args?: string[], options?: SpawnOptions) => Promise<WebContainerProcess>;
}
export interface TerminalRef {
  writeToTerminal: (data: string) => void;
  clearTerminal: () => void;
  focusTerminal: () => void;
}
const themes = {
  dark: { background: "#09090B", foreground: "#FAFAFA", cursor: "#FAFAFA" },
  light: { background: "#FFFFFF", foreground: "#18181B", cursor: "#18181B" },
};

const TerminalComponent = forwardRef<TerminalRef, TerminalProps>((props, ref) => {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const queue = useRef<TerminalOutputQueue | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const line = useRef("");
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const command = useRef<{ controller: AbortController; process: WebContainerProcess | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [failure, setFailure] = useState(false);
  const ready = Boolean(props.webContainerInstance && (props.runtimeReady ?? true));
  const write = useCallback((text: string) => queue.current?.enqueue(text), []);
  const prompt = useCallback(() => { line.current = ""; historyIndex.current = -1; write("\r\n$ "); }, [write]);
  const stopCommand = useCallback(() => {
    const active = command.current;
    if (!active) return;
    active.controller.abort(); active.process?.kill();
    active.process = null;
  }, []);
  const clear = useCallback(() => {
    line.current = ""; historyIndex.current = -1;
    queue.current?.clear(() => term.current?.reset());
    setTruncated(false); write("LiveIDE terminal\r\n");
    if (!command.current) prompt();
  }, [write, prompt]);
  useImperativeHandle(ref, () => ({writeToTerminal: write, clearTerminal: clear, focusTerminal: () => term.current?.focus()}));

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({cursorBlink: true, fontFamily: 'Consolas, monospace', fontSize: 14,
      convertEol: true, scrollback: TERMINAL_SCROLLBACK, theme: themes.dark});
    const fit = new FitAddon(); const finder = new SearchAddon();
    terminal.loadAddon(fit); terminal.loadAddon(finder); terminal.loadAddon(new WebLinksAddon());
    terminal.open(host.current); term.current = terminal; search.current = finder;
    const output = new TerminalOutputQueue((data, parsed) => terminal.write(data, parsed), () => setTruncated(true), () => setFailure(true));
    queue.current = output;
    let disposed = false;
    const execute = async () => {
      if (command.current) return;
      const text = line.current.trim(); line.current = "";
      if (text && history.current.at(-1) !== text) {
        history.current.push(text);
        if (history.current.length > TERMINAL_HISTORY_LIMIT) history.current.shift();
      }
      if (!text) { prompt(); return; }
      if (text === "clear") { clear(); return; }
      if (text === "help") { write("\r\nCommands: clear, history, help. Other commands run in the project runtime.\r\nCtrl+C stops a command.\r\n"); prompt(); return; }
      if (text === "history") { write("\r\n" + history.current.map((item, index) => `${index + 1}  ${item}`).join("\r\n")); prompt(); return; }
      const current = latest.current;
      if (!current.webContainerInstance || current.runtimeReady === false) { write("\r\nRuntime is not ready. Start or retry it before running commands."); prompt(); return; }
      const active = {controller: new AbortController(), process: null as WebContainerProcess | null};
      let exited = false;
      command.current = active; setBusy(true); write("\r\n");
      try {
        const [cmd, ...args] = text.split(/\s+/);
        const spawned = current.spawnProcess ? current.spawnProcess(cmd, args, {terminal: {cols: terminal.cols, rows: terminal.rows}})
          : current.webContainerInstance.spawn(cmd, args, {terminal: {cols: terminal.cols, rows: terminal.rows}});
        // A spawn can finish after cancellation; dispose its late process.
        void spawned.then(process => { if (active.controller.signal.aborted) { process.kill(); void process.exit.catch(() => undefined); } }, () => undefined);
        const process = await waitForOperation(spawned, active.controller.signal); active.process = process;
        void process.exit.catch(() => undefined);
        let budget = 0;
        const piping = consumeProcessOutput(process.output, active.controller.signal, async data => {
          if (disposed || active.controller.signal.aborted) return;
          output.enqueue(data); budget += data.length;
          if (budget >= 16 * 1024) { budget = 0; await new Promise(resolve => setTimeout(resolve, 0)); }
        });
        void piping.catch(() => undefined);
        const outputFailure = piping.then(() => new Promise<number>(() => undefined));
        const code = await waitForOperation(Promise.race([process.exit, outputFailure]), active.controller.signal);
        exited = true;
        await waitForOperation(piping, active.controller.signal, 1000, "Output stream did not close").catch(() => {
          if (!active.controller.signal.aborted && !disposed) write("\r\n[Remaining command output could not be drained]");
        });
        active.controller.abort();
        if (!disposed) write(`\r\nProcess exited with code ${code}.`);
      } catch (error) {
        if (!disposed) write(active.controller.signal.aborted ? "\r\nCommand stopped." : `\r\nCommand failed: ${error instanceof Error ? error.message : "Unable to run command"}`);
      } finally {
        active.controller.abort(); if (!exited) active.process?.kill();
        if (command.current === active) command.current = null;
        if (!disposed) { setBusy(false); prompt(); }
      }
    };
    const input = terminal.onData(data => {
      if (data === "\x03") {
        if (command.current) stopCommand(); else {write("^C"); prompt();}
        return;
      }
      if (command.current) return;
      if (data === "\r") { void execute(); return; }
      if (data === "\x7f") { if (line.current) {line.current = line.current.slice(0, -1); write("\b \b");} return; }
      if (data === "\x1b[A" || data === "\x1b[B") {
        if (!history.current.length) return;
        if (data === "\x1b[B" && historyIndex.current === -1) return;
        if (data === "\x1b[A") historyIndex.current = historyIndex.current < 0 ? history.current.length - 1 : Math.max(0, historyIndex.current - 1);
        else historyIndex.current = historyIndex.current >= history.current.length - 1 ? -1 : historyIndex.current + 1;
        line.current = historyIndex.current < 0 ? "" : history.current[historyIndex.current];
        write("\r\x1b[2K$ " + line.current); return;
      }
      // Pasted control characters must not submit commands automatically.
      if (data.startsWith("\x1b")) return;
      const text = data.replace(/[\x00-\x1f\x7f]/g, "").slice(0, TERMINAL_INPUT_LIMIT - line.current.length);
      line.current += text; write(text);
    });
    output.enqueue("LiveIDE terminal\r\nType 'help' for available commands.\r\n$ ");
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (!disposed) {
        try {
          const dimensions = fit.proposeDimensions();
          if (dimensions) terminal.resize(Math.min(dimensions.cols, 500), Math.min(dimensions.rows, 200));
        }
        catch { setFailure(true); }
      } }, 100);
    };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    return () => {
      disposed = true; if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect(); input.dispose(); stopCommand(); command.current = null;
      output.dispose(); terminal.dispose(); queue.current = null; term.current = null; search.current = null;
    };
  }, [clear, prompt, stopCommand, write]);
  useEffect(() => { if (term.current) term.current.options.theme = themes[props.theme ?? "dark"]; }, [props.theme]);
  useEffect(() => { if (!ready) stopCommand(); return () => stopCommand(); }, [ready, props.webContainerInstance, stopCommand]);
  if (failure) throw new Error("Terminal display failed");

  const copy = async () => { const selected = term.current?.getSelection(); if (selected && navigator.clipboard) await navigator.clipboard.writeText(selected).catch(() => undefined); };
  const download = () => {
    const buffer = term.current?.buffer.active; if (!buffer) return;
    const lines = Array.from({length: buffer.length}, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
    const url = URL.createObjectURL(new Blob([lines.join("\n")], {type: "text/plain"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "terminal-log.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <div className={cn("flex flex-col h-full bg-background border rounded-lg overflow-hidden", props.className)}>
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-muted/50">
      <div className="flex items-center gap-2 text-xs"><span>Terminal</span><span>{ready ? busy ? "Running command" : "Ready" : "Runtime unavailable"}</span></div>
      <div className="flex items-center gap-1">
        {showSearch && <Input aria-label="Search terminal" placeholder="Search..." value={searchTerm} onChange={event => {setSearchTerm(event.target.value); search.current?.findNext(event.target.value);}} className="h-6 w-32 text-xs" />}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Stop terminal command" disabled={!busy} onClick={stopCommand}><Square className="size-3" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Search terminal output" onClick={() => setShowSearch(value => !value)}><Search className="size-3" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Copy terminal selection" onClick={copy}><Copy className="size-3" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Download retained terminal output" onClick={download}><Download className="size-3" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Clear terminal" onClick={clear}><Trash2 className="size-3" /></Button>
      </div>
    </div>
    {truncated && <div role="status" className="px-3 py-1 text-xs text-muted-foreground">Older pending output omitted. Download contains retained output only.</div>}
    <div className="flex-1 min-h-0 relative"><div ref={host} aria-label="Project terminal" className="absolute inset-0 p-2" /></div>
  </div>;
});
TerminalComponent.displayName = "TerminalComponent";
export default TerminalComponent;

// @vitest-environment jsdom
import React, {createRef} from "react";
import type { WebContainer } from "@webcontainer/api";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { deferred, flushRuntime, processFixture } from "./fixtures/webcontainer";
const mocks=vi.hoisted(()=>({input: null as null | ((data:string)=>void), instances: [] as Array<{write:ReturnType<typeof vi.fn>;dispose:ReturnType<typeof vi.fn>;reset:ReturnType<typeof vi.fn>}>}));
vi.mock("@xterm/xterm/css/xterm.css",()=>({}));
vi.mock("@xterm/xterm",()=>({Terminal: class {
  options={};cols=80;rows=24;buffer={active:{length:0}};
  write=vi.fn((_data:string,parsed?:()=>void)=>queueMicrotask(()=>parsed?.())); dispose=vi.fn();reset=vi.fn();
  constructor(){mocks.instances.push(this);} open(){} loadAddon(){} resize(){} focus(){} getSelection(){return "";}
  onData(callback:(data:string)=>void){mocks.input=callback;return {dispose:vi.fn()};}
}}));
vi.mock("@xterm/addon-fit",()=>({FitAddon:class {proposeDimensions(){return {cols:80,rows:24};}}}));
vi.mock("@xterm/addon-search",()=>({SearchAddon:class {findNext(){}}}));
vi.mock("@xterm/addon-web-links",()=>({WebLinksAddon:class {}}));
import TerminalComponent, {type TerminalRef} from "@/features/webcontainers/components/terminal";
const instance={} as WebContainer;
beforeEach(()=>{vi.useFakeTimers();mocks.instances=[];mocks.input=null;vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
const input=(text:string)=>act(()=>mocks.input!(text));
const drain=async()=>act(async()=>{await vi.runAllTimersAsync();await flushRuntime();});
const text=()=>mocks.instances.at(-1)!.write.mock.calls.map(call=>call[0]).join("");
it("retains the terminal across callback, theme, ready and failure changes",async()=>{
 const props={webContainerInstance:instance,spawnProcess:vi.fn(),runtimeReady:true};
 const view=render(<TerminalComponent {...props}/>); const original=mocks.instances[0];
 view.rerender(<TerminalComponent {...props} theme="light" spawnProcess={vi.fn()} runtimeReady={false}/>);
 expect(mocks.instances).toHaveLength(1);expect(original.dispose).not.toHaveBeenCalled();expect(screen.getByText("Runtime unavailable")).toBeVisible();
 view.unmount();expect(original.dispose).toHaveBeenCalledOnce();
});
it("prints nonzero process exit and allows another command",async()=>{
 const process=processFixture(Promise.resolve(7)).process;
 process.output=new ReadableStream({start(controller){controller.enqueue("failure output");controller.close();}});
 const spawn=vi.fn().mockResolvedValue(process);render(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady/>);
 input("node");input("\r"); await act(flushRuntime);await drain();
 expect(text()).toContain("failure output");expect(text()).toContain("Process exited with code 7");
 expect(screen.getByRole("button",{name:"Stop terminal command"})).toBeDisabled();
 input("node");input("\r");await act(flushRuntime);expect(spawn).toHaveBeenCalledTimes(2);
});
it("cancels a pending spawn and kills its late result without a stale prompt",async()=>{
 const pending=deferred<ReturnType<typeof processFixture>["process"]>();const spawn=vi.fn().mockReturnValue(pending.promise);
 render(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady/>);
 input("node");input("\r");fireEvent.click(screen.getByRole("button",{name:"Stop terminal command"}));await act(flushRuntime);
 const late=processFixture();await act(async()=>{pending.resolve(late.process);await flushRuntime();});await drain();
 expect(late.process.kill).toHaveBeenCalledOnce();expect(text()).toContain("Command stopped");
});
it("handles output stream errors and stops the command",async()=>{
 const process=processFixture().process;process.output=new ReadableStream({start(controller){controller.error(new Error("Stream failed"));}});
 render(<TerminalComponent webContainerInstance={instance} spawnProcess={vi.fn().mockResolvedValue(process)} runtimeReady/>);
 input("node");input("\r");await act(flushRuntime);await drain();expect(text()).toContain("Command failed: Stream failed");expect(process.kill).toHaveBeenCalled();
});
it("blocks runtime commands while unavailable and bounds input",async()=>{
 const spawn=vi.fn();const view=render(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady={false}/>);
 input("node");input("\r");await drain();expect(spawn).not.toHaveBeenCalled();expect(text()).toContain("Runtime is not ready");
 const pending=deferred<ReturnType<typeof processFixture>["process"]>();spawn.mockReturnValue(pending.promise);
 view.rerender(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady/>);
 input("x".repeat(10000));input("\r");expect(spawn.mock.calls[0][0]).toHaveLength(4096);
});
it("bounds retained command history",async()=>{
 const ref=createRef<TerminalRef>();cleanup();mocks.instances=[];
 render(<TerminalComponent ref={ref} runtimeReady={false}/>);
 for(let i=0;i<205;i++){input(`cmd-${String(i).padStart(3,"0")}`);input("\r");}
 act(()=>ref.current!.clearTerminal());input("history");input("\r");await drain();
 expect(text()).not.toContain("cmd-000");expect(text()).toContain("cmd-204");
});

it("does not replace a new draft command when Down is pressed outside history navigation",async()=>{
 const pending=deferred<ReturnType<typeof processFixture>["process"]>();const spawn=vi.fn().mockReturnValue(pending.promise);
 const view=render(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady={false}/>);
 input("previous");input("\r");view.rerender(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady/>);
 input("draft");input("\x1b[B");input("\r");expect(spawn.mock.calls[0][0]).toBe("draft");
});
it("does not execute pasted submission controls",()=>{
 const pending=deferred<ReturnType<typeof processFixture>["process"]>();const spawn=vi.fn().mockReturnValue(pending.promise);
 render(<TerminalComponent webContainerInstance={instance} spawnProcess={spawn} runtimeReady/>);
 input("node\r\nanother");expect(spawn).not.toHaveBeenCalled();input("\r");expect(spawn.mock.calls[0][0]).toBe("nodeanother");
});

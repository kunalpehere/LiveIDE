import { expect, it, vi } from "vitest";
import { consumeProcessOutput } from "@/features/webcontainers/service/process-output";
import { deferred, flushRuntime } from "./fixtures/webcontainer";
it("releases a pending reader without cancelling an SDK source and permits its late close", async () => {
 let controller!:ReadableStreamDefaultController<string>;const cancel=vi.fn();const stream=new ReadableStream<string>({start(value){controller=value;},cancel});
 const signal=new AbortController();const write=vi.fn();const consuming=consumeProcessOutput(stream,signal.signal,write);
 controller.enqueue("before");await flushRuntime();signal.abort();await consuming;
 expect(stream.locked).toBe(false);expect(cancel).not.toHaveBeenCalled();expect(()=>controller.close()).not.toThrow();expect(write).toHaveBeenCalledExactlyOnceWith("before");
});
it("stops forwarding while a consumer write is pending and observes late producer completion", async () => {
 let controller!:ReadableStreamDefaultController<string>;const stream=new ReadableStream<string>({start(value){controller=value;}});
 const waiting=deferred<void>();const write=vi.fn(()=>waiting.promise);const signal=new AbortController();
 const consuming=consumeProcessOutput(stream,signal.signal,write);controller.enqueue("first");await flushRuntime();signal.abort();controller.enqueue("late");controller.close();waiting.resolve();await consuming;
 expect(write).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);
});
it("surfaces stream failure and releases its lock", async () => {
 const signal=new AbortController();const stream=new ReadableStream<string>({start(controller){controller.error(new Error("SDK output failed"));}});
 await expect(consumeProcessOutput(stream,signal.signal,vi.fn())).rejects.toThrow("SDK output failed");expect(stream.locked).toBe(false);
});
it("consumes normal EOF in order without cancellation", async () => {
 const write=vi.fn();const cancel=vi.fn();const stream=new ReadableStream<string>({start(controller){controller.enqueue("one");controller.enqueue("two");controller.close();},cancel});
 await consumeProcessOutput(stream,new AbortController().signal,write);expect(write.mock.calls.flat()).toEqual(["one","two"]);expect(cancel).not.toHaveBeenCalled();expect(stream.locked).toBe(false);
});

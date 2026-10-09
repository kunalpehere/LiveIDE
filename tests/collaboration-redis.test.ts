import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (message: string) => void>();
  const subscriber = {
    isOpen: true,
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(async (channel: string, listener: (message: string) => void) => { listeners.set(channel, listener); }),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  const publisher = {
    isOpen: true,
    connect: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn(() => subscriber),
    publish: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return { listeners, publisher, subscriber, createClient: vi.fn(() => publisher) };
});

vi.mock("redis", () => ({ createClient: mocks.createClient }));

import { createCollaborationRedisBridge } from "../scripts/collaboration-redis.mjs";
import { collaborationRoom, configureYjsValidation } from "@/lib/collaboration-protocol.mjs";
import * as Y from "yjs";
configureYjsValidation(Y.decodeUpdate);
const room = collaborationRoom("project-1", "src/App.tsx", 1);
const message = { protocolVersion: 1 as const, role: "EDITOR" as const, playgroundId: "project-1", filePath: "src/App.tsx", revision: 1, room, type: "update" as const, data: "AAA=" };

describe("distributed collaboration Redis bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses separate publisher and subscriber connections", async () => {
    const bridge = await createCollaborationRedisBridge({ url: "redis://test", instanceId: "instance-a" });
    expect(mocks.publisher.duplicate).toHaveBeenCalledOnce();
    expect(mocks.publisher.connect).toHaveBeenCalledOnce();
    expect(mocks.subscriber.connect).toHaveBeenCalledOnce();
    await bridge?.close();
  });

  it("publishes updates and forwards messages from other instances only", async () => {
    const received = vi.fn();
    const bridge = await createCollaborationRedisBridge({ url: "redis://test", instanceId: "instance-a" });
    await bridge?.subscribe(room, received);
    await bridge?.publish(message);
    expect(mocks.publisher.publish.mock.calls[0][0]).toBe(`liveide:collaboration:${room}`);
    expect(JSON.parse(mocks.publisher.publish.mock.calls[0][1])).toEqual({ ...message, instanceId: "instance-a" });

    const listener = mocks.listeners.get(`liveide:collaboration:${room}`);
    listener?.(JSON.stringify({ ...message, instanceId: "instance-a" }));
    listener?.(JSON.stringify({ ...message, instanceId: "instance-b" }));
    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith({ ...message, instanceId: "instance-b" });
  });
  it("rejects invalid versions and mismatched room identities before delivering Redis messages", async () => {
    const received = vi.fn();
    const onError = vi.fn();
    const bridge = await createCollaborationRedisBridge({ url: "redis://test", instanceId: "instance-a", onError });
    await bridge?.subscribe(room, received);
    const listener = mocks.listeners.get(`liveide:collaboration:${room}`);
    listener?.(JSON.stringify({ ...message, protocolVersion: 2, instanceId: "instance-b" }));
    listener?.(JSON.stringify({ ...message, revision: 2, instanceId: "instance-b" }));
    listener?.(JSON.stringify({ ...message, data: "not-base64", instanceId: "instance-b" }));
    expect(received).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(3);
  });
});

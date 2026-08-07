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
    await bridge?.subscribe("room-1", received);
    await bridge?.publish("room-1", "update", "AQID");
    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      "liveide:collaboration:room-1",
      JSON.stringify({ instanceId: "instance-a", type: "update", data: "AQID" }),
    );

    const listener = mocks.listeners.get("liveide:collaboration:room-1");
    listener?.(JSON.stringify({ instanceId: "instance-a", type: "update", data: "own" }));
    listener?.(JSON.stringify({ instanceId: "instance-b", type: "update", data: "remote" }));
    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith({ instanceId: "instance-b", type: "update", data: "remote" });
  });
});


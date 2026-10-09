import type { RelayMessage } from "../lib/collaboration-protocol";

export function createCollaborationRedisBridge(options: {
  url?: string;
  instanceId: string;
  onError?: (message: string, error: unknown) => void;
}): Promise<null | {
  isReady(): boolean;
  subscribe(room: string, onMessage: (payload: RelayMessage) => void): Promise<void>;
  publish(message: Omit<RelayMessage, "instanceId">): Promise<void>;
  close(): Promise<void>;
}>;

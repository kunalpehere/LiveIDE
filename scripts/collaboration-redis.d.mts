export function createCollaborationRedisBridge(options: {
  url?: string;
  instanceId: string;
  onError?: (message: string, error: unknown) => void;
}): Promise<null | {
  subscribe(room: string, onMessage: (payload: { instanceId: string; type: string; data: string }) => void): Promise<void>;
  publish(room: string, type: string, data: string): Promise<void>;
  close(): Promise<void>;
}>;

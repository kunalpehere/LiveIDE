import type { z } from "zod";
import type { sessionSchema, claimsSchema, tokenRequestSchema, tokenResponseSchema, errorResponseSchema, relayMessageSchema, snapshotQuerySchema, snapshotSaveSchema, snapshotResponseSchema, snapshotAckSchema } from "./collaboration-protocol.mjs";
import type { validateYjsMessage } from "./collaboration-protocol.mjs";

// Types are derived from the exact schemas used by the standalone JS server.
export type CollaborationSession = z.infer<typeof sessionSchema>;
export type CollaborationClaims = z.infer<typeof claimsSchema>;
export type TokenRequest = z.infer<typeof tokenRequestSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type ProtocolErrorResponse = z.infer<typeof errorResponseSchema>;
export type RelayMessage = z.infer<typeof relayMessageSchema>;
export type SnapshotQuery = z.infer<typeof snapshotQuerySchema>;
export type SnapshotSave = z.infer<typeof snapshotSaveSchema>;
export type SnapshotResponse = z.infer<typeof snapshotResponseSchema>;
export type SnapshotAck = z.infer<typeof snapshotAckSchema>;
export type BinaryMessage = ReturnType<typeof validateYjsMessage>;
export type ClientMessage = TokenRequest | SnapshotQuery | SnapshotSave | BinaryMessage;
export type ServerMessage = TokenResponse | SnapshotResponse | SnapshotAck | ProtocolErrorResponse | BinaryMessage;

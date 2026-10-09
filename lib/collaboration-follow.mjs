import { z } from "zod";
import * as decoding from "lib0/decoding";
import { filePathSchema, CollaborationProtocolError } from "./collaboration-protocol.mjs";

const coordinate = z.number().int().min(1).max(10_000_000);
export const followViewSchema = z.object({
  filePath: filePathSchema,
  selection: z.object({ selectionStartLineNumber: coordinate, selectionStartColumn: coordinate,
    positionLineNumber: coordinate, positionColumn: coordinate }).strict(),
  scrollTop: z.number().finite().min(0).max(100_000_000),
  scrollLeft: z.number().finite().min(0).max(100_000_000),
}).strict();
export const participantSchema = z.object({
  user: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(320), color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
  view: followViewSchema.nullable(),
  following: z.number().int().nonnegative().nullable(),
});

/** Bind one awareness ID and the displayed identity to this authorized socket.
 * @param {{userId: string, name: string, color: string}} claims
 * @param {(id: number) => boolean} isOwnedElsewhere
 */
export function createFollowPresenceValidator(claims, isOwnedElsewhere) {
  /** @type {number | undefined} */ let owned;
  /** @param {Uint8Array} raw */
  return raw => {
    const message = decoding.createDecoder(raw);
    if (decoding.readVarUint(message) !== 1) return;
    const payload = decoding.createDecoder(decoding.readVarUint8Array(message));
    if (decoding.readVarUint(payload) !== 1) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
    const id = decoding.readVarUint(payload);
    decoding.readVarUint(payload);
    const state = JSON.parse(decoding.readVarString(payload));
    if ((owned !== undefined && owned !== id) || isOwnedElsewhere(id)) throw new CollaborationProtocolError("FORBIDDEN");
    if (state !== null) {
      const parsed = participantSchema.safeParse(state);
      if (!parsed.success) throw new CollaborationProtocolError("MALFORMED_MESSAGE");
      if (parsed.data.user.id !== claims.userId || parsed.data.user.name !== claims.name || parsed.data.user.color !== claims.color) throw new CollaborationProtocolError("FORBIDDEN");
    }
    owned = id;
  };
}

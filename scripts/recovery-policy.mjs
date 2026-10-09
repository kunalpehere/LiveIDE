import { createHash } from "node:crypto";

/** This drill accepts only its own anonymous, loopback, nonce-named databases. */
export function requireDrillUri(uri, expectedKind) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("Invalid recovery drill URI"); }
  const match = /^\/liveide_recovery_([a-f0-9]{16})_(source|restored)$/.exec(parsed.pathname);
  const queryKeys = [...parsed.searchParams.keys()];
  if (parsed.protocol !== "mongodb:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password || !match ||
      !parsed.port || Number(parsed.port) < 1024 || parsed.searchParams.get("directConnection") !== "true" ||
      parsed.searchParams.get("replicaSet") !== `liveide-recovery-${match[1]}` || (expectedKind && match[2] !== expectedKind) ||
      queryKeys.some(key => !["directConnection", "replicaSet", "serverSelectionTimeoutMS"].includes(key)) ||
      new Set(queryKeys).size !== queryKeys.length) {
    throw new Error("Recovery drill requires its own loopback replica set and disposable database name");
  }
  return { database: match[0].slice(1), nonce: match[1], kind: match[2], port: Number(parsed.port) };
}

/** Stable comparisons retain array order, Date values, and missing-vs-null fields. */
export function canonical(value) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function assertRecoveryInventory(expected, restored) {
  if (digest(expected) !== digest(restored)) throw new Error("Restored documents, collection coverage, or indexes differ from the backup baseline");
}

export function assertArchiveDigest(expected, actual) {
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) throw new Error("Recovery archive checksum mismatch");
}

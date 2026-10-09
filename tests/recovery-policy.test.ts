import { describe, expect, it } from "vitest";
import { requireDrillUri, digest, assertRecoveryInventory, assertArchiveDigest } from "@/scripts/recovery-policy.mjs";
const nonce = "0123456789abcdef";
const uri = `mongodb://127.0.0.1:28117/liveide_recovery_${nonce}_restored?directConnection=true&replicaSet=liveide-recovery-${nonce}`;
describe("database recovery isolation and verification", () => {
  it("accepts only the nonce-named isolated loopback replica set", () => {
    expect(requireDrillUri(uri, "restored")).toMatchObject({ kind: "restored", nonce, port: 28117 });
  });
  it.each([
    uri.replace("127.0.0.1", "database.example.com"),
    uri.replace("127.0.0.1", "user:secret@127.0.0.1"),
    uri.replace(`liveide_recovery_${nonce}_restored`, "liveide"),
    uri.replace("mongodb:", "mongodb+srv:"),
    uri.replace("28117", "80"),
    uri.replace("directConnection=true", "directConnection=false"),
    uri.replace(`replicaSet=liveide-recovery-${nonce}`, "replicaSet=production"),
    uri + "&proxyHost=foreign.example.com",
    uri + "&replicaSet=production",
  ])("rejects foreign or unsafe recovery targets", candidate => {
    expect(() => requireDrillUri(candidate, "restored")).toThrow();
  });
  it("rejects a source database used as an application verification target", () => {
    expect(() => requireDrillUri(uri.replace("_restored?", "_source?"), "restored")).toThrow();
  });
  it("compares stable object order while detecting changed dates, missing fields, content and array order", () => {
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
    expect(digest({ content: null })).not.toBe(digest({}));
    expect(digest(["a", "b"])).not.toBe(digest(["b", "a"]));
    expect(digest(new Date(0))).not.toBe(digest(new Date(1)));
    expect(() => assertRecoveryInventory({ tree: "before" }, { tree: "after" })).toThrow();
    expect(() => assertRecoveryInventory({ indexes: 2 }, { indexes: 1 })).toThrow();
    expect(() => assertRecoveryInventory({ indexKey: [["userId", 1], ["createdAt", -1]] }, { indexKey: [["createdAt", -1], ["userId", 1]] })).toThrow();
  });
  it("rejects an altered archive before restore", () => {
    const hash = "a".repeat(64);
    expect(() => assertArchiveDigest(hash, hash)).not.toThrow();
    expect(() => assertArchiveDigest(hash, "b".repeat(64))).toThrow(/checksum/);
    expect(() => assertArchiveDigest("", "")).toThrow();
  });
});

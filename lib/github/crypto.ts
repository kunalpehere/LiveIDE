import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { githubConfiguration } from "./config";

export const nonce = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("base64url");

// Bind every ciphertext to its user and purpose; moving records cannot grant access.
export function encrypt(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(githubConfiguration().encryptionKey, "hex"), iv);
  cipher.setAAD(Buffer.from(`liveide-github:v1:${context}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(value: string, context: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid GitHub credential");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(githubConfiguration().encryptionKey, "hex"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`liveide-github:v1:${context}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

import crypto from "node:crypto";
import { env } from "./env.js";

const ALG = "aes-256-gcm";
const IV_LEN = 12;

function key(): Buffer {
  // Any string works — hashed to 32 bytes so operators can use a passphrase.
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

/** Encrypt SMTP/Slack secrets at rest. Format: `iv:tag:cipher` (hex). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("bad encrypted payload");
  const decipher = crypto.createDecipheriv(ALG, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const out = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return out.toString("utf8");
}

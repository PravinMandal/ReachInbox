import crypto from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const transportCache = new Map<string, Transporter>();

function getTransport(senderId: string, smtpUser: string, smtpPassEnc: string): Transporter {
  // Key includes a credential fingerprint so SMTP rotations (via API/DB) take
  // effect without a worker restart; stale entries age out via the cap below.
  const fp = crypto.createHash("sha1").update(smtpPassEnc).digest("hex").slice(0, 8);
  const cacheKey = `${senderId}:${fp}`;
  const cached = transportCache.get(cacheKey);
  if (cached) return cached;
  const t = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: decryptSecret(smtpPassEnc) },
  });
  if (transportCache.size > 20) transportCache.clear();
  transportCache.set(cacheKey, t);
  return t;
}

export interface SendInput {
  senderId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

/** Send one email via the sender's Ethereal SMTP account. */
export async function sendEmail(input: SendInput): Promise<SendResult> {
  const sender = await prisma.sender.findUniqueOrThrow({ where: { id: input.senderId } });
  const transport = getTransport(sender.id, sender.smtpUser, sender.smtpPass);
  // Body is sanitized HTML (rich-text) or plain text — send both parts so every
  // client renders formatting while text-only readers still get content.
  const looksHtml = /<[a-z][\s\S]*>/i.test(input.body);
  const info = await transport.sendMail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: looksHtml ? input.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : input.body,
    ...(looksHtml ? { html: input.body } : {}),
  });
  return {
    messageId: info.messageId ?? "",
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
  };
}

/**
 * Seed N Ethereal test accounts as Sender rows for a user. Offline-safe:
 * if `createTestAccount()` fails (no network), log and continue — the UI
 * still works, sends will fail loudly per-email rather than at login.
 *
 * NOTE (verified 2026-09-28): Ethereal's test-account API currently returns the
 * SAME credentials for rapid repeat calls. Distinct Sender rows (distinct From
 * addresses + distinct quota keys) are still created — sending identity for a
 * fake-SMTP demo is the From header, and per-sender quota isolation is enforced
 * app-side in Redis. So a shared credential pair is acceptable, not a bug.
 */
export async function ensureEtherealPool(userId: string, fromEmail: string): Promise<void> {
  const existing = await prisma.sender.count({ where: { userId } });
  if (existing >= env.ETHEREAL_POOL_SIZE) return;
  const need = env.ETHEREAL_POOL_SIZE - existing;
  const domain = fromEmail.split("@")[1] ?? "ethereal.email";
  for (let i = 0; i < need; i++) {
    try {
      const account = await nodemailer.createTestAccount();
      await prisma.sender.create({
        data: {
          userId,
          fromEmail: i === 0 ? fromEmail : `sender${existing + i}@${domain}`,
          smtpUser: account.user,
          smtpPass: encryptSecret(account.pass),
        },
      });
      logger.info({ userId, smtpUser: account.user }, "seeded Ethereal sender");
    } catch (err) {
      logger.warn({ err }, "Ethereal createTestAccount failed (offline?) — sender pool skipped");
      return;
    }
  }
}

import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Outbound auth mail (verification links). Gmail OAuth2 — same pattern as the
 * MoonSeek project. Ethereal is deliberately NOT used here: verification mail
 * must reach real inboxes, and Ethereal never delivers.
 */
function getTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: env.GMAIL_USER,
      clientId: env.GMAIL_CLIENT_ID,
      clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken: env.GMAIL_REFRESH_TOKEN,
    },
  });
}

export function verifyMailConfigured(): boolean {
  return Boolean(env.GMAIL_USER && env.GMAIL_REFRESH_TOKEN);
}

export async function sendVerificationMail(to: string, link: string, name = ""): Promise<void> {
  if (!verifyMailConfigured()) {
    logger.warn("GMAIL_* not configured — verification email skipped (user must resend later)");
    return;
  }
  await getTransporter().sendMail({
    from: `"ReachInbox" <${env.GMAIL_USER}>`,
    to,
    subject: "Verify your email — ReachInbox",
    html: `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
        <h2 style="margin:0 0 8px">Welcome to ReachInbox${name ? `, ${name}` : ""} 👋</h2>
        <p style="color:#333;line-height:1.6">Thanks for creating your account. You're one click away from scheduling emails.</p>
        <p style="color:#333;line-height:1.6">Please verify your email to activate your account. This link expires in <b>15 minutes</b>.</p>
        <div style="margin:24px 0">
          <a href="${link}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Verify Email →</a>
        </div>
        <p style="color:#666;font-size:13px;line-height:1.5">Button not working? Copy and paste this link into your browser:<br><a href="${link}" style="color:#16a34a;word-break:break-all">${link}</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0" />
        <p style="color:#999;font-size:12px">Didn't create this account? Ignore this email — no action needed.</p>
        <p style="color:#999;font-size:12px;margin-top:4px">— The ReachInbox Team</p>
      </div>
    `,
    text: `Welcome to ReachInbox${name ? `, ${name}` : ""}!\n\nVerify your email within 15 minutes:\n${link}\n\nIf you didn't create this account, ignore this email.\n— ReachInbox`,
  });
}

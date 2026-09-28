import { prisma } from "./db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { redis } from "./redis.js";
import { secsUntilHourEnd, slackNotifiedKey } from "./time.js";

export function slackAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: "chat:write,chat:write.public",
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCode(code: string, userId: string): Promise<{ channelId: string }> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    access_token?: string;
    team?: { id?: string };
    error?: string;
  };
  if (!json.ok || !json.access_token) throw new Error(`Slack OAuth failed: ${json.error ?? "unknown"}`);
  const channelId = env.SLACK_DEFAULT_CHANNEL_ID;
  await prisma.slackToken.upsert({
    where: { userId },
    create: { userId, botToken: encryptSecret(json.access_token), channelId, teamId: json.team?.id },
    update: { botToken: encryptSecret(json.access_token), channelId, teamId: json.team?.id },
  });
  return { channelId };
}

/**
 * Post exactly one message per sender per hour window. Silent no-op when Slack
 * is not connected — rate limiting must never crash because chat is missing.
 */
export async function notifyRateLimitOnce(args: {
  userId: string;
  senderId: string;
  fromEmail: string;
  hourBucket: string;
  sent: number;
  cap: number;
  delayed: number;
}): Promise<void> {
  try {
    const key = slackNotifiedKey(args.senderId, args.hourBucket);
    const added = await redis.set(key, "1", "EX", secsUntilHourEnd() + 60, "NX");
    if (!added) return; // already notified this window

    const token = await prisma.slackToken.findUnique({ where: { userId: args.userId } });
    if (!token?.botToken || !token.channelId) return;

    const text =
      `:warning: Hourly email limit hit — *${args.fromEmail}* in hour ${args.hourBucket} UTC ` +
      `(${args.sent}/${args.cap} sent). ${args.delayed} email(s) delayed to the next window.`;
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptSecret(token.botToken)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: token.channelId, text }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) logger.warn({ error: json.error, senderId: args.senderId }, "Slack postMessage failed");
    else logger.info({ senderId: args.senderId, hour: args.hourBucket }, "Slack rate-limit alert sent");
  } catch (err) {
    logger.warn({ err }, "Slack notify failed (non-fatal)");
  }
}

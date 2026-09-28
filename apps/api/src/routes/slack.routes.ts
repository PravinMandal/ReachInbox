import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { env } from "../env.js";
import { exchangeSlackCode, slackAuthorizeUrl } from "../slack.js";

export const slackRouter = Router();

const SLACK_STATE_PURPOSE = "slack_oauth_state";

function signSlackState(userId: string): string {
  return jwt.sign({ sub: userId, purpose: SLACK_STATE_PURPOSE }, env.JWT_SECRET, { expiresIn: "10m" });
}

function verifySlackState(state: string): string {
  const decoded = jwt.verify(state, env.JWT_SECRET) as { sub?: string; purpose?: string };
  if (!decoded.sub || decoded.purpose !== SLACK_STATE_PURPOSE) throw new Error("Invalid Slack state");
  return decoded.sub;
}

slackRouter.get("/connect", authMiddleware, (req, res) => {
  if (!env.SLACK_CLIENT_ID) {
    return res.status(500).json({ error: { code: "NOT_CONFIGURED", message: "Slack app not configured" } });
  }
  res.json({ url: slackAuthorizeUrl(signSlackState(req.userId!)) });
});

// OAuth callback — top-level browser navigation (never XHR), so failures
// redirect back to Settings with a flag instead of JSON.
slackRouter.get("/callback", async (req, res) => {
  const done = (flag: string) =>
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, "")}/settings?slack=${flag}`);
  try {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) return done("error");
    let userId: string;
    try {
      // Accept signed state; fall back to raw userId for old in-flight connects.
      userId = verifySlackState(state);
    } catch {
      if (!/^[\w-]{1,64}$/.test(state)) return done("error");
      userId = state;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return done("error");
    await exchangeSlackCode(code, userId);
    return done("connected");
  } catch {
    return done("error");
  }
});

slackRouter.get("/status", authMiddleware, async (req, res, next) => {
  try {
    const row = await prisma.slackToken.findUnique({ where: { userId: req.userId! } });
    res.json({ connected: !!row, channelId: row?.channelId ?? null });
  } catch (err) {
    next(err);
  }
});

slackRouter.delete("/disconnect", authMiddleware, async (req, res, next) => {
  try {
    await prisma.slackToken.deleteMany({ where: { userId: req.userId! } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

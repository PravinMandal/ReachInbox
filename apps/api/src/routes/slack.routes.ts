import { Router } from "express";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { env } from "../env.js";
import { exchangeSlackCode, slackAuthorizeUrl } from "../slack.js";

export const slackRouter = Router();

slackRouter.get("/connect", authMiddleware, (req, res) => {
  if (!env.SLACK_CLIENT_ID) {
    return res.status(500).json({ error: { code: "NOT_CONFIGURED", message: "Slack app not configured" } });
  }
  res.json({ url: slackAuthorizeUrl(req.userId!) });
});

// OAuth callback — Slack redirects here with ?code&state=userId (unauthenticated by design).
slackRouter.get("/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code ?? "");
    const userId = String(req.query.state ?? "");
    if (!code || !userId) return res.status(400).send("Missing code/state");
    await exchangeSlackCode(code, userId);
    res.redirect(`${env.FRONTEND_URL}/settings?slack=connected`);
  } catch (err) {
    next(err);
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

import { Router } from "express";
import { prisma } from "../db.js";
import { redis } from "../redis.js";
import { esClient, esConfigured } from "../es.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, string> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "up";
  } catch {
    checks.db = "down";
  }
  try {
    await redis.ping();
    checks.redis = "up";
  } catch {
    checks.redis = "down";
  }
  try {
    if (!esConfigured()) checks.es = "fallback";
    else {
      await esClient().ping();
      checks.es = "up";
    }
  } catch {
    checks.es = "down";
  }
  const ok = checks.db === "up" && checks.redis === "up";
  res.status(ok ? 200 : 503).json({ ok, ...checks, esDegraded: checks.es !== "up" });
});

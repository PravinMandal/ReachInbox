import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { searchEs } from "../es.js";
import { logger } from "../logger.js";

export const emailsRouter = Router();
emailsRouter.use(authMiddleware);

const ALLOWED_SORT = new Set(["scheduledAt", "sentAt", "createdAt"]);

interface FallbackRow {
  id: string;
  to: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: string;
  previewUrl: string | null;
}

/**
 * Postgres fallback search: trigram-similarity ranked (`pg_trgm` migration),
 * degrading gracefully to plain ILIKE when the extension is missing.
 * Never throws — worst case returns unranked ILIKE matches.
 */
async function searchFallback(
  userId: string,
  q: string,
  status: string | undefined,
  page: number,
  limit: number,
  sort: string,
  order: string,
): Promise<{ data: FallbackRow[]; total: number }> {
  const like = `%${q}%`;
  const statusFilter = status ? Prisma.sql`AND status = ${status}::"EmailStatus"` : Prisma.empty;
  try {
    const rows = await prisma.$queryRaw<FallbackRow[]>`
      SELECT id, "to", subject, "scheduledAt", "sentAt", status, "previewUrl",
             GREATEST(similarity("to", ${q}), similarity(subject, ${q})) AS sim
      FROM "Email"
      WHERE "userId" = ${userId} ${statusFilter}
        AND ("to" ILIKE ${like} OR subject ILIKE ${like}
             OR similarity("to", ${q}) > 0.15 OR similarity(subject, ${q}) > 0.15)
      ORDER BY sim DESC, "scheduledAt" DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    const total = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Email"
      WHERE "userId" = ${userId} ${statusFilter}
        AND ("to" ILIKE ${like} OR subject ILIKE ${like}
             OR similarity("to", ${q}) > 0.15 OR similarity(subject, ${q}) > 0.15)`;
    return { data: rows, total: Number(total[0]?.count ?? 0) };
  } catch (err) {
    logger.warn({ err }, "trigram search unavailable — plain ILIKE fallback");
    const where = {
      userId,
      ...(status ? { status: status as never } : {}),
      OR: [
        { to: { contains: q, mode: "insensitive" as const } },
        { subject: { contains: q, mode: "insensitive" as const } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);
    return { data: rows.map((r) => ({ ...r, status: String(r.status) })), total };
  }
}

async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId!;
    const status = req.query.status as string | undefined;
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const sortRaw = String(req.query.sort ?? "scheduledAt");
    const sort = ALLOWED_SORT.has(sortRaw) ? sortRaw : "scheduledAt";
    const order = req.query.order === "asc" ? "asc" : "desc";

    if (q) {
      try {
        const { ids, total } = await searchEs({ userId, q, status, from: (page - 1) * limit, size: limit });
        if (ids.length === 0) {
          res.json({ data: [], page, limit, total, source: "es" });
          return;
        }
        const rows = await prisma.email.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        res.json({ data: ids.map((id) => byId.get(id)).filter(Boolean), page, limit, total, source: "es" });
        return;
      } catch (err) {
        logger.warn({ err }, "ES search failed — Postgres fallback");
        const fb = await searchFallback(userId, q, status, page, limit, sort, order);
        res.json({ ...fb, page, limit, source: "db-fallback", warning: "Search index unavailable" });
        return;
      }
    }

    const where = { userId, ...(status ? { status: status as never } : {}) };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);
    res.json({ data: rows, page, limit, total, source: "db" });
  } catch (err) {
    next(err);
  }
}

/** NOTE: `/search` alias + `/counts/summary` must be registered BEFORE `/:id`. */
emailsRouter.get("/", listHandler);
emailsRouter.get("/search", listHandler);

emailsRouter.get("/counts/summary", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const [scheduled, sent, failed] = await Promise.all([
      prisma.email.count({ where: { userId, status: "scheduled" } }),
      prisma.email.count({ where: { userId, status: "sent" } }),
      prisma.email.count({ where: { userId, status: "failed" } }),
    ]);
    res.json({ scheduled, sent, failed });
  } catch (err) {
    next(err);
  }
});

emailsRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await prisma.email.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { sender: { select: { fromEmail: true } } },
    });
    if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Email not found" } });
    res.json({ email: row });
  } catch (err) {
    next(err);
  }
});

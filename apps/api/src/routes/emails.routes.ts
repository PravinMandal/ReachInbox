import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { Prisma, type EmailStatus } from "@prisma/client";
import { emailQuerySchema } from "@reachinbox/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { searchEs, removeEmail } from "../es.js";
import { emailQueue } from "../queue.js";
import { logger } from "../logger.js";

export const emailsRouter = Router();
emailsRouter.use(authMiddleware);

interface FallbackRow {
  id: string;
  to: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: string;
  previewUrl: string | null;
  starred: boolean;
}

/**
 * Postgres fallback search: trigram-similarity ranked (`pg_trgm` migration),
 * degrading gracefully to plain ILIKE when the extension is missing.
 * Never throws — worst case returns unranked ILIKE matches.
 */
async function searchFallback(
  userId: string,
  q: string,
  status: string | string[] | undefined,
  page: number,
  limit: number,
  sort: string,
  order: string,
): Promise<{ data: FallbackRow[]; total: number }> {
  const like = `%${q}%`;
  const list = Array.isArray(status) ? status : status ? [status] : [];
  const statusFilter =
    list.length === 0
      ? Prisma.empty
      : Prisma.sql`AND status IN (${Prisma.join(list.map((s) => Prisma.sql`${s}::"EmailStatus"`))})`;
  try {
    const rows = await prisma.$queryRaw<FallbackRow[]>`
      SELECT id, "to", subject, "scheduledAt", "sentAt", status, "previewUrl", "starred",
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
      ...(list.length ? { status: { in: list as EmailStatus[] } } : {}),
      OR: [
        { to: { contains: q, mode: "insensitive" as const } },
        { subject: { contains: q, mode: "insensitive" as const } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true, starred: true },
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
    // Shared contract validation — rejects bad status/sort/etc with 400
    // instead of letting Prisma throw a 500 (e.g. ?status=banana).
    const parsed = emailQuerySchema.safeParse({
      status: req.query.status,
      q: typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
      order: req.query.order,
    });
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid query" },
      });
      return;
    }
    const { status, q = "", page, limit, sort, order } = parsed.data;
    // Spec Sent table shows status (sent / failed): the "sent" tab includes
    // failed rows so failures are never invisible in the inbox (Queues keeps
    // exact per-state tabs).
    const statuses: EmailStatus[] = status === "sent" ? ["sent", "failed"] : status ? [status] : [];

    if (q) {
      try {
        const { ids, total } = await searchEs({ userId, q, status: statuses.length ? statuses : undefined, from: (page - 1) * limit, size: limit });
        if (ids.length === 0) {
          res.json({ data: [], page, limit, total, source: "es" });
          return;
        }
        const rows = await prisma.email.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true, starred: true },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        res.json({ data: ids.map((id) => byId.get(id)).filter(Boolean), page, limit, total, source: "es" });
        return;
      } catch (err) {
        logger.warn({ err }, "ES search failed — Postgres fallback");
        const fb = await searchFallback(userId, q, statuses.length ? statuses : undefined, page, limit, sort, order);
        res.json({ ...fb, page, limit, source: "db-fallback", warning: "Search index unavailable" });
        return;
      }
    }

    const where = { userId, ...(statuses.length ? { status: { in: statuses } } : {}) };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        select: { id: true, to: true, subject: true, scheduledAt: true, sentAt: true, status: true, previewUrl: true, starred: true },
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
      // "Sent" mailbox = terminal rows (sent + failed), matching the Sent tab.
      prisma.email.count({ where: { userId, status: { in: ["sent", "failed"] } } }),
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

emailsRouter.patch("/:id/star", async (req, res, next) => {
  try {
    const starred = req.body?.starred;
    if (typeof starred !== "boolean") {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "starred must be a boolean" } });
    }
    const updated = await prisma.email.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: { starred },
    });
    if (updated.count === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Email not found" } });
    }
    res.json({ id: req.params.id, starred });
  } catch (err) {
    next(err);
  }
});

emailsRouter.delete("/:id", async (req, res, next) => {
  try {
    const row = await prisma.email.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true },
    });
    if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Email not found" } });
    // Best-effort job removal: a deleted scheduled email must never fire later.
    await emailQueue
      .getJob(row.id)
      .then((job) => job?.remove().catch(() => undefined))
      .catch(() => undefined);
    await prisma.email.delete({ where: { id: row.id } });
    await removeEmail(row.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

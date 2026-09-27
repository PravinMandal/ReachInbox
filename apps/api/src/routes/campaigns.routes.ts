import { Router } from "express";
import multer from "multer";
import sanitizeHtml from "sanitize-html";
import { extractEmails } from "@reachinbox/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { emailQueue } from "../queue.js";
import { indexMany } from "../es.js";
import { env, isVercel } from "../env.js";
import { logger } from "../logger.js";

export const campaignsRouter = Router();
campaignsRouter.use(authMiddleware);

/** memoryStorage only — serverless has no writable disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (isVercel ? 4 : 5) * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.csv$/i.test(file.originalname) || /\.txt$/i.test(file.originalname) || /csv|plain|text|octet/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv / .txt lead files are accepted"));
    }
  },
});

const MAX_LOCAL = 2000;
const MAX_VERCEL = 500;

/**
 * POST /api/campaigns/schedule (multipart)
 * Fields: subject, body, senderId?, from?, startAt (ISO), delaySec, hourlyLimit,
 * `to` (JSON array or delimiter string, optional), `leads` file (csv/txt, optional).
 * staggered scheduledAt = startAt + i*delaySec → bulk insert (chunks) →
 * addBulk delayed jobs with jobId=email.id → bulk ES index.
 */
campaignsRouter.post("/schedule", upload.single("leads"), async (req, res, next) => {
  try {
    const userId = req.userId!;
    const subject = String(req.body.subject ?? "").trim();
    const bodyRaw = String(req.body.body ?? "").trim();
    const startAt = new Date(String(req.body.startAt ?? ""));
    const delaySec = Math.max(0, Math.min(3600, Number(req.body.delaySec ?? 2) || 0));
    const hourlyLimit = Math.max(
      1,
      Math.min(10_000, Number(req.body.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_GLOBAL) || 200),
    );

    if (!subject) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Subject is required" } });
    if (!bodyRaw) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Body is required" } });
    if (Number.isNaN(startAt.getTime())) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "startAt must be ISO datetime" } });
    }

    let sender = null;
    if (req.body.senderId) sender = await prisma.sender.findFirst({ where: { id: String(req.body.senderId), userId } });
    if (!sender && req.body.from) {
      sender = await prisma.sender.findFirst({ where: { userId, fromEmail: String(req.body.from).toLowerCase() } });
    }
    if (!sender) sender = await prisma.sender.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (!sender) {
      return res.status(400).json({ error: { code: "NO_SENDER", message: "No sender found. Connect Ethereal first." } });
    }

    const body = sanitizeHtml(bodyRaw, {
      // Rich-text from the TipTap editor — allow formatting, strip the rest
      // (scripts, styles, forms, images). Plain-text campaigns pass through.
      allowedTags: [
        "p", "br", "strong", "em", "b", "i", "u", "s", "strike",
        "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "a",
      ],
      allowedAttributes: {
        a: ["href", "target", "rel"],
        p: ["style"],
        h1: ["style"],
        h2: ["style"],
        h3: ["style"],
      },
      allowedStyles: {
        "*": { "text-align": [/^(left|center|right|justify)$/] },
      },
      transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener", target: "_blank" }) },
    });

    const explicit: string[] = [];
    if (req.body.to) {
      try {
        const arr = typeof req.body.to === "string" ? JSON.parse(req.body.to) : req.body.to;
        if (Array.isArray(arr)) explicit.push(...arr.map((s) => String(s)));
      } catch {
        explicit.push(...String(req.body.to).split(/[,;\s]+/));
      }
    }
    const fileText = req.file?.buffer?.toString("utf8") ?? "";
    const recipients = [...new Set([...extractEmails(explicit.join("\n")), ...extractEmails(fileText)])];

    if (recipients.length === 0) {
      return res.status(400).json({
        error: { code: "NO_RECIPIENTS", message: "No valid email addresses detected. Upload a CSV/TXT or add To addresses." },
      });
    }
    const cap = isVercel ? MAX_VERCEL : MAX_LOCAL;
    if (recipients.length > cap) {
      return res.status(400).json({
        error: { code: "TOO_MANY", message: `Max ${cap} recipients per batch (got ${recipients.length})` },
      });
    }

    const gapMs = delaySec * 1000;
    const batch = await prisma.batch.create({
      data: { userId, senderId: sender.id, subject, body, startAt, delaySec, hourlyLimit, total: recipients.length },
    });

    const now = Date.now();
    const senderId = sender.id;
    for (let i = 0; i < recipients.length; i += 200) {
      const chunk = recipients.slice(i, i + 200).map((to, k) => ({
        batchId: batch.id,
        userId,
        senderId,
        to,
        subject,
        body,
        scheduledAt: new Date(Math.max(startAt.getTime() + (i + k) * gapMs, now + (i + k) * 10)),
      }));
      await prisma.email.createMany({ data: chunk });
    }
    const persisted = await prisma.email.findMany({
      where: { batchId: batch.id },
      select: { id: true, to: true, scheduledAt: true },
      orderBy: { scheduledAt: "asc" },
    });

    for (let i = 0; i < persisted.length; i += 100) {
      const chunk = persisted.slice(i, i + 100);
      await emailQueue.addBulk(
        chunk.map((e, k) => ({
          name: "send",
          data: { emailId: e.id, index: i + k, gapMs },
          opts: { jobId: e.id, delay: Math.max(0, e.scheduledAt.getTime() - Date.now()) },
        })),
      );
    }

    await indexMany(
      persisted.map((e) => ({
        id: e.id,
        userId,
        batchId: batch.id,
        senderId,
        to: e.to,
        subject,
        body: body.slice(0, 5000),
        status: "scheduled",
        scheduledAt: e.scheduledAt.toISOString(),
        sentAt: null,
      })),
    ).catch((e) => logger.warn({ e }, "bulk ES index failed (non-fatal)"));

    const firstAt = persisted[0]?.scheduledAt ?? startAt;
    const lastAt = persisted[persisted.length - 1]?.scheduledAt ?? startAt;
    const effectiveCap = Math.min(env.MAX_EMAILS_PER_HOUR_GLOBAL, hourlyLimit);
    const estimatedHours = Math.max(1, Math.ceil(persisted.length / effectiveCap));

    res.status(201).json({
      batchId: batch.id,
      total: persisted.length,
      detected: recipients.length,
      firstAt,
      lastAt,
      estimatedHours,
      note:
        persisted.length > effectiveCap
          ? `Scheduled across ~${estimatedHours}h due to hourly caps (best-effort order).`
          : "Scheduled.",
    });
  } catch (err) {
    next(err);
  }
});

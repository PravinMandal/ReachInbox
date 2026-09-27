import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { encryptSecret } from "../crypto.js";

export const sendersRouter = Router();
sendersRouter.use(authMiddleware);

sendersRouter.get("/", async (req, res, next) => {
  try {
    const senders = await prisma.sender.findMany({
      where: { userId: req.userId! },
      select: { id: true, fromEmail: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ senders });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  fromEmail: z.string().email(),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
});

sendersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: { code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid" } });
    }
    const sender = await prisma.sender.create({
      data: {
        userId: req.userId!,
        fromEmail: parsed.data.fromEmail.toLowerCase(),
        smtpUser: parsed.data.smtpUser,
        smtpPass: encryptSecret(parsed.data.smtpPass),
      },
      select: { id: true, fromEmail: true, createdAt: true },
    });
    res.status(201).json({ sender });
  } catch (err) {
    next(err);
  }
});

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
// Static JSON import: @bull-board/api locates its UI at runtime through an
// eval'd require.resolve('@bull-board/ui/package.json'), which serverless
// file-tracers cannot see. This import forces the file into the bundle.
import uiPackageJson from "@bull-board/ui/package.json" with { type: "json" };
void uiPackageJson;
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { emailQueue } from "./queue.js";
import { ensureIndex } from "./es.js";
import { authMiddleware } from "./auth.js";
import { errorMiddleware, notFound } from "./middleware/error.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { sendersRouter } from "./routes/senders.routes.js";
import { campaignsRouter } from "./routes/campaigns.routes.js";
import { emailsRouter } from "./routes/emails.routes.js";
import { slackRouter } from "./routes/slack.routes.js";
import { workerRouter } from "./routes/worker.routes.js";

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/senders", sendersRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/emails", emailsRouter);
  app.use("/api/slack", slackRouter);
  app.use("/api/worker", workerRouter);

  // Live BullMQ dashboard — JWT-gated like every other /api route.
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  // Cast: @bull-board/api pins an older bullmq Job type; at runtime the
  // adapter only calls queue getters, which are stable across 5.x.
  createBullBoard({ queues: [new BullMQAdapter(emailQueue) as never], serverAdapter });
  app.use("/admin/queues", authMiddleware, serverAdapter.getRouter());

  app.use("/api", notFound);
  app.use(errorMiddleware);
  return app;
}

/** Fire-and-forget ES setup — never blocks boot (fallback covers search). */
export function initSearch(): void {
  ensureIndex().catch((err) => logger.warn({ err }, "ensureIndex failed at boot"));
}

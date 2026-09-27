import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pinoHttp } from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
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
  // UI assets are VENDORED (apps/api/vendor/bull-board-ui, see its README):
  // @bull-board/api resolves its EJS shell via eval'd require.resolve, which
  // serverless file-tracers cannot follow (live 500'd with "Failed to lookup
  // view index.ejs"). uiBasePath (import.meta-relative, tracer-visible) ships
  // the files inside the bundle on every host. If the directory ever goes
  // missing, degrade to a clean pointer instead of a 500 stack.
  const uiBasePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "bull-board-ui");
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  // Cast: @bull-board/api pins an older bullmq Job type; at runtime the
  // adapter only calls queue getters, which are stable across 5.x.
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue) as never],
    serverAdapter,
    options: { uiBasePath, uiConfig: {} },
  });
  app.use(
    "/admin/queues",
    authMiddleware,
    (req, res, next) => {
      // Layout mirrors @bull-board/ui (dist/index.ejs + dist/static).
      if (!existsSync(path.join(uiBasePath, "dist", "index.ejs"))) {
        res.status(503).json({
          error: {
            code: "BOARD_UNAVAILABLE",
            message: "Advanced board assets missing on this host — use the native /queues dashboard.",
          },
        });
        return;
      }
      next();
    },
    serverAdapter.getRouter(),
  );

  app.use("/api", notFound);
  app.use(errorMiddleware);
  return app;
}

/** Fire-and-forget ES setup — never blocks boot (fallback covers search). */
export function initSearch(): void {
  ensureIndex().catch((err) => logger.warn({ err }, "ensureIndex failed at boot"));
}

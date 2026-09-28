import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

/** Final error boundary — always JSON, never leaks stacks in prod. */
export function errorMiddleware(err: ApiError, _req: Request, res: Response, _next: NextFunction): void {
  // Multer upload errors arrive without our status/code — map them to HTTP.
  const multerCode = (err as { code?: string }).code;
  if (multerCode === "LIMIT_FILE_SIZE") {
    err.status = 413;
    err.code = "FILE_TOO_LARGE";
    err.message = "Lead file too large (5MB local, 4MB live)";
  } else if (multerCode === "LIMIT_FILE_COUNT" || multerCode === "LIMIT_UNEXPECTED_FILE") {
    err.status = 400;
    err.code = "BAD_FILE";
  } else if (multerCode === "P2002") {
    // Prisma unique violation (e.g. duplicate sender) — client error, not 500.
    err.status = 409;
    err.code = "CONFLICT";
    err.message = "Already exists";
  }
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err }, "unhandled error");
  res.status(status).json({
    error: { code: err.code ?? "INTERNAL_ERROR", message: err.message || "Something went wrong" },
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
}

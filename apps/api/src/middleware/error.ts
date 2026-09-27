import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

/** Final error boundary — always JSON, never leaks stacks in prod. */
export function errorMiddleware(err: ApiError, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err }, "unhandled error");
  res.status(status).json({
    error: { code: err.code ?? "INTERNAL_ERROR", message: err.message || "Something went wrong" },
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
}

import pino from "pino";
import { env } from "./env.js";

/** Single process-wide logger. No `console.log` in request/worker paths. */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
      : undefined,
});

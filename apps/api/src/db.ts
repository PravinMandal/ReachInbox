import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton — one pool per process. `api` and `worker` are separate
 * processes so each gets its own instance. On Neon/Vercel use
 * `?pgbouncer=true&connection_limit=1` in DATABASE_URL.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

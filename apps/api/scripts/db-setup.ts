import { prisma } from "../src/db.js";
import { logger } from "../src/logger.js";

/**
 * Post-migrate setup that lives OUTSIDE `prisma/migrations` on purpose:
 * `prisma migrate dev` treats raw-SQL-only drift (extension, GIN indexes) as
 * something to "fix" and auto-generates DROP migrations for it. This script is
 * idempotent (`IF NOT EXISTS`) — run after every `migrate deploy/reset`:
 *   npm run db:setup
 * Neon/prod owners can run the same statements (extension needs owner rights).
 */
async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Email_to_trgm_idx" ON "Email" USING gin ("to" gin_trgm_ops)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Email_subject_trgm_idx" ON "Email" USING gin (subject gin_trgm_ops)`,
  );
  logger.info("pg_trgm setup done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "pg_trgm setup failed");
    process.exit(1);
  });

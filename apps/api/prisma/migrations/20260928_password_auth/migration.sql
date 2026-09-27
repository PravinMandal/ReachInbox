-- Password auth (mirrors MoonSeek semantics on Prisma): optional googleId,
-- per-user password hash, verification flag. Trigram indexes from db:setup are
-- intentionally left alone (see scripts/db-setup.ts).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "googleId" DROP NOT NULL;

-- Google-linked accounts are implicitly verified (Google verified the email).
UPDATE "User" SET "isVerified" = true WHERE "googleId" IS NOT NULL;

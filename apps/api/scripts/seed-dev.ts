import { prisma } from "../src/db.js";
import { ensureEtherealPool } from "../src/mailer.js";
import { logger } from "../src/logger.js";

/** Dev-only: ensure dev-user exists and seed a REAL Ethereal sender pool. */
async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: "oliver.brown@domain.io" },
    create: { id: "dev-user", googleId: "dev-google-id", email: "oliver.brown@domain.io", name: "Oliver Brown" },
    update: {},
  });
  await ensureEtherealPool(user.id, user.email);
  const n = await prisma.sender.count({ where: { userId: user.id } });
  logger.info({ senders: n }, "dev ethereal seed done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "dev seed failed");
    process.exit(1);
  });

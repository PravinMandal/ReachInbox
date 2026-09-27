import { prisma } from "../src/db.js";
import { encryptSecret } from "../src/crypto.js";
import { logger } from "../src/logger.js";

/**
 * Dev seed: one Google-less user + one Ethereal sender placeholder so the UI
 * boots without OAuth. Real login path seeds real Ethereal accounts.
 */
async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: "oliver.brown@domain.io" },
    create: { googleId: "dev-google-id", email: "oliver.brown@domain.io", name: "Oliver Brown" },
    update: {},
  });
  const senders = await prisma.sender.count({ where: { userId: user.id } });
  if (senders === 0) {
    await prisma.sender.create({
      data: {
        userId: user.id,
        fromEmail: user.email,
        smtpUser: "placeholder",
        smtpPass: encryptSecret("placeholder"),
      },
    });
  }
  logger.info("seed done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "seed failed");
    process.exit(1);
  });

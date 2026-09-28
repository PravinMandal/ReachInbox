import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { encryptSecret } from "../src/crypto.js";
import { processOne } from "../src/processor.js";
import { UnrecoverableError } from "bullmq";

/**
 * Retry-classifier regression: a 535 auth failure must go straight to
 * `failed` (UnrecoverableError), NOT back to `scheduled` for BullMQ backoff.
 * The old /4\d\d/ regex matched 535 as "transient", so bad credentials
 * retried for hours burning quota instead of failing visibly into the Sent
 * tab. A genuine transient (ETIMEDOUT) must still return to `scheduled`.
 */
describe("processor retry classifier", () => {
  const stamp = Date.now().toString(36);
  const email = `classify-${stamp}@ex.io`;
  let senderId = "";
  let batchId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email, name: "Classifier", passwordHash: "x", isVerified: true },
    });
    // Fake SMTP creds (properly encrypted): every send fails fast with 535,
    // no network round-trip beyond the local Ethereal handshake.
    const sender = await prisma.sender.create({
      data: { userId: user.id, fromEmail: email, smtpUser: "u", smtpPass: encryptSecret("wrong-password") },
    });
    senderId = sender.id;
    const batch = await prisma.batch.create({
      data: {
        userId: user.id, senderId, subject: "c", body: "b",
        startAt: new Date(), delaySec: 1, hourlyLimit: 200, total: 2,
      },
    });
    batchId = batch.id;
  });

  afterAll(async () => {
    await prisma.email.deleteMany({ where: { batchId } });
    await prisma.batch.delete({ where: { id: batchId } });
    await prisma.sender.deleteMany({ where: { id: senderId } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  async function makeRow(to: string) {
    return prisma.email.create({
      data: {
        batchId, userId: (await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).userId,
        senderId, to, subject: "c", body: "b", scheduledAt: new Date(),
      },
    });
  }

  it("535 auth failure fails permanently", async () => {
    const row = await makeRow(`auth-${stamp}@ex.io`);
    await expect(processOne(row.id)).rejects.toBeInstanceOf(UnrecoverableError);
    const after = await prisma.email.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("failed");
    expect(after.error ?? "").toMatch(/535|auth/i);
  }, 30_000);
});

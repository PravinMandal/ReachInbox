import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

/**
 * Validated runtime config. Fail fast with a readable message so a
 * misconfigured demo never boots half-working. All caps are env-driven
 * (spec §Throughput) — nothing throttling-related is hardcoded.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  REDIS_URL: z.string().min(1, "REDIS_URL required").default("redis://localhost:6379"),
  ES_NODE: z.string().default("http://localhost:9200"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be 32+ chars"),
  ENCRYPTION_KEY: z.string().min(16).default("dev-only-encryption-key-32bytes!"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  // Outbound mail for auth (verification emails must reach REAL inboxes —
  // Ethereal never delivers). Gmail OAuth2, same pattern as the MoonSeek project.
  GMAIL_USER: z.string().default(""),
  GMAIL_CLIENT_ID: z.string().default(""),
  GMAIL_CLIENT_SECRET: z.string().default(""),
  GMAIL_REFRESH_TOKEN: z.string().default(""),
  SLACK_CLIENT_ID: z.string().default(""),
  SLACK_CLIENT_SECRET: z.string().default(""),
  SLACK_REDIRECT_URI: z.string().default("http://localhost:4000/api/slack/callback"),
  SLACK_DEFAULT_CHANNEL_ID: z.string().default(""),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  MIN_GAP_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
  MAX_EMAILS_PER_HOUR_GLOBAL: z.coerce.number().int().min(1).max(100_000).default(200),
  STALE_SENDING_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  ETHEREAL_POOL_SIZE: z.coerce.number().int().min(1).max(10).default(2),
  CRON_SECRET: z.string().default(""),
  DEV_AUTH_BYPASS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DEV_USER_EMAIL: z.string().email().default("oliver.brown@domain.io"),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      "Invalid environment:\n" +
        parsed.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
/** True on Vercel serverless — no `app.listen`, no persistent worker. */
export const isVercel = Boolean(process.env.VERCEL);

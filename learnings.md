# Learnings (living doc — read first after every compact)

> Source of truth for WHY decisions were made. Re-read this + `docs/ACTIONS.md`,
> `docs/ASSUMPTIONS.md`, `docs/TRADEOFFS.md`, `problemStatement.md`, and
> `/home/pravin/.opencode/plan/plan.md` after every compact to avoid hallucination.

## 2026-09-27 — Reboot with TS-everywhere + Vercel-free target

- Spec (`problemStatement.md`): Backend MUST be TypeScript/Express/BullMQ/Redis,
  Postgres-or-MySQL, Ethereal SMTP. No cron anywhere (no crontab, no node-cron).
  Frontend React + Tailwind, TypeScript strongly preferred + graded
  ("Proper TypeScript usage"). User confirmed TS for frontend too.
- Design truth: `Design Images/*.png` (7 shots, no live Figma URL). Mint active
  `#e6f4ea`-ish, green accent, 260px sidebar, pill inputs, orange time pill
  (scheduled) vs grey Sent pill. Dark/light toggle is user-added — Tailwind
  `class` strategy, never `media`.
- Deploy target: live on Vercel for $0 (user request). Vercel Hobby has no
  persistent processes → BullMQ delayed jobs can't fire on time. Two runtimes,
  one codebase: Docker path = graded zero-cron truth; Vercel path = same
  `processOne()` behind secret-guarded `POST /api/worker/tick`, driven by an
  EXTERNAL pinger (GitHub Actions `*/10` in `.github/workflows/tick.yml`, or
  cron-job.org @1min). Verified 2026-09-28 from Vercel docs: Hobby crons are
  daily-only and sub-daily schedules fail deployment — Vercel Cron must NOT be
  the live waker. Rejected QStash-per-email (doubles truth).
- Free services: Neon (PG pooler, `connection_limit=1`), Upstash Redis over
  TCP `rediss://` ONLY (BullMQ needs Lua/streams; REST/KV will not work),
  Bonsai sandbox or ES unset → Postgres `ILIKE` fallback with `source` flag.
  Vercel limits: 10s function timeout, 4.5MB payload, cookies `None; Secure` cross-site.

## Technical learnings (verify before changing)

1. BullMQ limiter is queue-global via Redis. `max:1, duration:2000` serializes
   dequeue to 1/2s across ALL workers. Kept deliberately — staggering alone
   collapses on overlapping campaigns/retries/requeues. Concurrency still helps
   surrounding I/O.
2. Rate-limit reschedule needs the worker token. Processor `(job, token)`:
   `await job.moveToDelayed(Date.now()+ms, token); throw new DelayedError();`
   Without token → `Missing lock`. Without throw → job completes/burns attempt.
3. Reservation-before-CAS. Lua `check-and-incr` FIRST (DB untouched on LIMITED).
   Then CAS `scheduled→sending` (accept `sending` for same-job BullMQ retries).
   CAS miss after reservation → `DECR` compensate, dup-ok, never send.
4. At-least-once SMTP. Crash between SMTP-accept and `mark sent` can double-send.
   `jobId=email.id` + CAS = best-effort dedup, never claim exactly-once.
5. Order best-effort. Reschedule `msUntilNextHour + index*gapMs + jitter(0-2s)`.
   Pure random jitter destroys order; deterministic offset preserves it best-effort.
6. ES must not break sends. Index failures catch-and-log, never throw into SMTP
   path. Search falls back to Postgres with `source:'db-fallback'`.
7. Slack dedup `SET NX` on `slack:notified:{sender}:{hour}`, TTL to hour-end+60s.
   Silent no-op when unconnected. One message/sender/hour max.
8. Redis AOF + DB reconciler. AOF keeps delayed jobs on `docker restart redis`;
   reconciler (`scheduled` miss + stale `sending` >5m) covers flushed Redis /
   crashed worker. Both needed.
9. `packages/shared` is TS (zod schemas + interfaces) — single validation truth
   for API + web. Import as `@reachinbox/shared`.
10. Serverless: `export default app`, no `app.listen` on Vercel; Prisma singleton
    + PgBouncer; multer `memoryStorage` only; prod upload cap 4MB (Vercel 4.5MB).
11. Free-tier numbers (verified 2026-09-28): Upstash free = 500K cmds/mo + 256MB,
    scale-to-zero (no polling worker live → plenty for demo scale); Neon free =
    0.5GB + 100 CU-hrs/project/mo, scale-to-zero; Vercel Hobby cron = daily-only.
12. UI libraries over hand-rolled: `sonner` (toasts), `cva`+`clsx`+`tailwind-merge`
    (variants), `react-hook-form`+zod (compose form). Hand-rolled Toast/Button was
    clutter — replaced.
13. Tests pinned: `vitest` everywhere (+`supertest` for API HTTP tests).
14. PG fallback quality: `pg_trgm` extension + GIN trigram indexes on
    `Email(to, subject)` + similarity-ordered raw query, so ES-down search still
    ranks instead of dumb `ILIKE`.
15. Queue name is `email-send` (no colon — BullMQ 5.81 rejects `:` as it is the
    key separator; verified 2026-09-28 at boot: `Queue name cannot contain :`).
    Kept as exported const `EMAIL_QUEUE_NAME` (single source).

## Continuity rule

- Append to `docs/ACTIONS.md` on every meaningful step (file created, test result).
- Never guess creds/URLs — placeholders in `.env.example`; real keys from user at end.
- Re-read `problemStatement.md` during work (user instruction) — spec drift is the
  top hallucination risk.

# Tradeoffs (explicit — also in README)

1. **Single queue vs per-sender queues.** Single `email-send`. Pro: one bull-board
   view, one limiter domain, `jobId` dedup trivial, reconciler simple. Con:
   per-sender isolation hand-rolled via Lua keys instead of free per-queue limiters.
2. **BullMQ limiter KEPT (`max:1/2000ms`).** Staggering alone collapses on overlap /
   retry / requeue. Limiter = global 2s floor (Redis-backed, cross-worker). Cost:
   dequeue serializes to 0.5/s; concurrency still parallelizes DB/ES/Slack I/O.
3. **Reservation-before-CAS (Lua first).** CAS-then-check strands rows in `sending`
   on LIMITED. Lua-first leaves DB untouched on limit path. Crash-after-INCR leaks
   a slot, TTL-bounded (≤1h), fail-closed (send fewer, never overshoot).
4. **ES dual-write (not outbox).** API indexes on create, worker re-indexes on
   terminal. Pro: simple, demo-friendly. Con: brief lag + possible drift (covered
   by `reindex` script). ES down never fails sends; search falls back with flag.
5. **`chat.postMessage` over webhooks.** Clean OAuth story, per-tenant tokens,
   reconnect without redeploy. Needs app install + bot in channel.
6. **JWT cookie, no rotation.** Simple, Postman-friendly via Bearer fallback.
   7d theft window; prod would add rotation + fingerprinting.
7. **Prisma over Drizzle/TypeORM.** Migrations + DX + `createMany` bulk.
8. **Vite SPA over Next.js.** Faster for dashboard; no SSR needed (no SEO use).
9. **Live tick vs zero-cron (central Vercel compromise).** Docker grading path:
   pure BullMQ delayed jobs, zero cron of any kind. Vercel live: same
   `processOne()` driven by secret-guarded `POST /api/worker/tick`, woken by an
   external free pinger (GHA `*/10`, fits the 2000-min private-repo budget at
   ~860 min/mo; or cron-job.org @1min) because Hobby has no persistent worker
   AND Hobby crons are daily-only (verified 2026-09-28 — sub-daily fails deploy).
   Rejected QStash-per-email (doubles truth).
10. **Libraries over hand-rolled UI.** `sonner` (toasts), `cva`+`clsx`+
    `tailwind-merge` (variants), `react-hook-form`+zod (compose), TipTap
    (rich-text — a static toolbar would have been dishonest clutter). Hand-rolled
    Toast/Button was clutter; deleted.
11. **Tests pinned to `vitest`** (+`supertest` for API). Pure-function units run
    without infra; integration needs Docker (documented, not mocked into fiction).
10. **Upstash TCP only.** BullMQ requires Lua/streams; REST mode incompatible.
    Higher latency accepted; correctness unchanged.

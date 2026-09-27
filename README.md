# ReachInbox — Email Job Scheduler

Production-grade email scheduler + dashboard (hiring assignment).
Express + TypeScript API, BullMQ + Redis delayed jobs (no cron), Postgres + Prisma,
Ethereal SMTP, Elasticsearch with Postgres fallback, live bull-board, Slack rate-limit
alerts, Google OAuth, Vite React + TS dashboard matching the Figma screenshots.

> Live target: **$0** — Vercel (web static + API serverless) + Neon + Upstash Redis.
> The graded Docker path is 100% spec-literal (zero cron); the live path reuses the
> same send pipeline behind an external pinger (documented below).

## 1. Run it (Docker — graded path)

```bash
cp .env.example .env            # then fill secrets (see §3)
cp .env apps/api/.env           # prisma CLI + tsx read CWD .env
docker compose up -d postgres redis elasticsearch
npm install
npm --workspace apps/api run db:migrate
npm --workspace apps/api run db:setup    # pg_trgm extension + similarity indexes
npm --workspace apps/api run db:seed:dev # dev user + Ethereal senders (needs network)

npm run dev:api     # :4000
npm run dev:worker  # BullMQ worker (separate process)
npm run dev:web     # :5173
```

Health: `GET localhost:4000/api/health` → `{ok, db, redis, es}`.
Queue dashboard: in-app `/queues` (sidebar → Queues: live counts, per-state tabs,
per-user job rows, retry) + advanced `localhost:4000/admin/queues` (bull-board, login-gated).

`DEV_AUTH_BYPASS=true` (local only, never prod) lets you click through the UI
without Google creds. Real login needs `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID`.

## 2. What was verified (2026-09-28, this machine)

| Check | Result |
|---|---|
| Schedule 5 → sent, `previewUrl` real | ✅ 5/5 Ethereal URLs |
| Min gap (BullMQ limiter) | ✅ dequeue spacing Δ1999–2003ms on bunched jobs |
| Hourly cap 2/sender | ✅ 2 sent/hr, rest delayed to next hour, fired on rollover |
| Delay-not-drop, order best-effort | ✅ DB untouched on LIMITED; `moveToDelayed+DelayedError` |
| Restart (node-only, jobs due mid-outage) | ✅ sent once, no dups |
| Restart (Redis+node, AOF replay) | ✅ sent once |
| ES search | ✅ `source:es`; fallback with ES stopped → `source:db-fallback` (trigram-ranked) |
| bull-board + native `/queues` | ✅ 200 + 30 rows render, scoped to caller |
| Frontend (Playwright, 0 console errors) | ✅ inbox tabs/counts, compose RHF+CSV count+toast, detail, settings, search, dark mode, login |
| Unit tests (`vitest`) | ✅ shared + api pass; `tsc` clean ×3, `vite build` ok |
| HTTP contract (`supertest`) | ✅ health/validation/authz matrix, no infra mocks |
| Failed → retry → sent | ✅ 535-auth fail, retry re-attempts, creds restored → sent + preview |
| Google ticket login | ✅ mint→consume→cookie, replay/garbage 401, SPA redeems pre-Guard |
| Load: 1000 schedule | ✅ 0.56s, estimatedHours=5, orphans cleaned from queue + ES |

Slack live-notify needs real app creds (silent-skip verified — no crash when
unconnected). Load script: `npm run bulk-schedule -- --count=1000 …` (JSON API).

## 3. Env

| Var | Meaning | Default |
|---|---|---|
| `GMAIL_USER` / `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Gmail OAuth2 sender for verification mail (must reach real inboxes) | — |
| `DATABASE_URL` | Postgres (local Docker / Neon pooler + `?pgbouncer=true&connection_limit=1`) | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_URL` | Redis — local `redis://`, live Upstash **TCP `rediss://` only** (REST breaks BullMQ) | `redis://localhost:6379` |
| `ES_NODE` | Elasticsearch — unset/empty → Postgres fallback | `http://localhost:9200` |
| `JWT_SECRET` / `ENCRYPTION_KEY` | session sign / secret encryption (32+/16+ chars) | — |
| `GOOGLE_CLIENT_ID` (+ `VITE_GOOGLE_CLIENT_ID`) + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REDIRECT_URI` | server-side Google OAuth (redirect flow, single-use ticket) | — |
| `SLACK_CLIENT_ID/SECRET/REDIRECT_URI`, `SLACK_DEFAULT_CHANNEL_ID` | OAuth + alert channel | — |
| `WORKER_CONCURRENCY` / `MIN_GAP_MS` / `MAX_EMAILS_PER_HOUR_GLOBAL` | 5 / 2000 / 200 | as shown |
| `STALE_SENDING_MINUTES` / `ETHEREAL_POOL_SIZE` | 5 / 2 | as shown |
| `CRON_SECRET` | guards `POST /api/worker/tick` (live) | — |
| `DEV_AUTH_BYPASS` / `DEV_USER_EMAIL` | local no-OAuth UI (dev only) | `false` |

Fail-fast zod validation at boot — misconfig never boots half-working.

## 4. Architecture

```
[Vite SPA] —REST+jwt cookie+multipart→ [Express API]
[API] → Postgres (truth) · Redis (jobs/counters/dedup/limiter) · ES (search, optional)
      → Ethereal SMTP · Google verify · Slack OAuth + chat.postMessage
      + bull-board /admin/queues
Local worker:  BullMQ delayed job fires → processOne()
Live (Vercel): external pinger → POST /api/worker/tick → processOne()  (same fn)
```

**Scheduling.** `POST /api/campaigns/schedule` computes `scheduledAt = startAt + i·delaySec`,
bulk-inserts (200/chunk), `addBulk`s delayed jobs with `jobId = email.id` (100/chunk),
bulk-indexes to ES. Attempts: 3, exponential backoff.

**Throttling (two layers).** Staggered delays (primary, preserves order) + BullMQ
`limiter {max:1, duration:MIN_GAP_MS}` (global 2s floor, Redis-backed, cross-worker).
Hourly quotas (global + per-sender) via one Lua `check-and-incr` (atomic, TTL 3700).

**Send pipeline** (`processOne`, shared by worker + tick): load → `sent`=dup-ok →
Lua reserve (**LIMITED → DB untouched**, reschedule `msUntilNextHour + index·gap + jitter`,
Slack once) → CAS `scheduled→sending` (accept `sending` for same-job retry; miss →
`DECR` compensate, dup-ok) → Ethereal send → `sent` (+`previewUrl`) / transient→`scheduled`
+ retry / permanent→`failed`+`UnrecoverableError` → ES reindex (never throws).

**Persistence.** Redis AOF keeps delayed jobs; reconciler on worker boot requeues
`scheduled` rows with no live job and resets stale `sending` (>5min). At-least-once
delivery, best-effort order — stated honestly, verified by test.

**Search.** ES `emails` index (`userId/status` keywords, `to^3/subject^2/body` match).
ES down/absent → trigram-similarity-ranked Postgres (`pg_trgm` GIN via `db:setup`,
plain ILIKE if extension missing). Responses carry `source: es|db|db-fallback`.

**Auth.** Google: server-side redirect flow (`/google/url` → Google → `/google/callback`
exchanges code, links identity) — the callback mints a **single-use login ticket**
(JWT 5m, Redis NX/GETDEL) redeemed same-origin (`/google/consume`), so no cross-site
cookie is ever written (Brave/ITP-proof; alias domains need no console edits).
Email/password: register → Gmail-OAuth2 verification link (15m) → login (403 until
verified). Both set the same 7-day JWT cookie.

**Slack.** `GET /slack/connect` → authorize (`state=userId`) → `/callback` exchanges,
stores encrypted bot token → `chat.postMessage` on first cap-hit per sender per hour
(`SET NX` dedup). Unconnected → silent skip. Disconnect/reconnect without redeploy.

## 5. API

`POST /api/auth/google`, `POST /api/auth/register`, `POST /api/auth/login`,
`GET /api/auth/verify-email`, `POST /api/auth/resend-verification`,
`GET /api/auth/me` · `POST /api/auth/logout` ·
`GET|POST /api/senders` · `POST /api/campaigns/schedule` (20 batches/hr/IP; multipart `leads` csv/txt ≤5MB,
≤2000/batch local, ≤500 live; 400/409/413 mapped, never 500) → `{batchId,total,detected,firstAt,lastAt,estimatedHours,note}` ·
`GET /api/emails?status&q&page` · `GET /api/emails/search` · `GET /api/emails/counts/summary` ·
`GET /api/emails/:id` · Slack `connect/callback/status/disconnect` ·
`GET /api/health` · `GET /api/worker/status` · `GET /api/worker/jobs?state=&limit=` (scoped) ·
`POST /api/worker/jobs/:id/retry` (failed only) · `POST /api/worker/tick` (needs `CRON_SECRET` when set).

## 6. Frontend (`apps/web`, React+TS)

Routes `/login /verify-email /(?tab) /compose /queues /email/:id /settings` mirroring the 7 Figma shots:
login card (Google redirect button + working email/password sign-in/sign-up with verification),
top header (user name/email/avatar + animated theme toggle + logout icon), responsive sidebar
(REACHINBOX brand tile, user card, Compose, CORE counts, live Queues, bottom-pinned Settings),
search pill + orange time pill vs grey Sent pill, compose (From dropdown, To chips `+n`, Upload List + live count,
Delay/Hourly, working rich-text toolbar (TipTap: B/I/U, lists, quote, link…), Send Later popover),
queues (live counts, per-state tabs, per-user job rows, retry), detail (formatted body, delivery + `previewUrl`),
settings (Slack connect, appearance, queue link). `sonner` toasts, `cva` variants,
`react-hook-form`+zod compose, `react-query`+`axios(withCredentials)`, debounced search,
skeletons/empty/error states, Tailwind `class` dark mode.

## 7. Deploy live ($0)

- **Web:** Vercel project, `vercel.web.json` (Vite build). Env: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`.
- **API:** Vercel project, `vercel.api.json` (serverless export `serverless.ts`).
  Env: Neon URL (pooler), Upstash TCP URL, `ES_NODE` (Bonsai or empty), OAuth/Slack,
  `FRONTEND_URL` (cookie `SameSite=None;Secure` in prod), `CRON_SECRET`.
- **Waker:** `.github/workflows/tick.yml` (GHA `*/10`, ~860 min/mo of the free
  2000-min budget) or cron-job.org @1min → `POST {API}/api/worker/tick?limit=25`.
  **Not Vercel Cron**: Hobby is daily-only (sub-daily fails deployment — verified).
- Live limits: ~500/batch, 4MB uploads (Vercel 10s/4.5MB), ~5–10min timing granularity.

## 8. Assumptions, shortcuts, tradeoffs

Assumptions: Figma screenshots are the spec (no live URL); email/password added alongside
Google (spec's Google requirement kept); UTC hour buckets; Ethereal may dedupe rapid test
accounts (verified — rows still distinct); at-least-once delivery; best-effort order;
dev-bypass local-only; live tick granularity ~10min (external pinger, Hobby has no
sub-daily cron); 500/batch + 4MB upload caps live.

Tradeoffs: single queue `email-send` (colon illegal in
BullMQ ≥5); limiter kept as backstop; reservation-before-CAS (fail-closed); ES dual-write
(not outbox) + `reindex` script; `chat.postMessage` over webhooks; JWT cookie, no rotation;
Vite SPA over Next (no SSR need, fewer Hobby invocations); Prisma (migration DX);
external pinger over Vercel Cron (daily-only Hobby); ticket-based Google login (no
cross-site cookie, console-independent).

## 9. Submission

- Private GitHub repo + access for `Mitrajit`, `Yadav036` (owner action).
- Demo video ≤5min — script in `docs/DEMO.md`.

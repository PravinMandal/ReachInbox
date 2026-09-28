# ReachInbox — Email Job Scheduler

Reliable cold-email scheduling at scale: an Express + BullMQ scheduler with a
React dashboard. Compose a campaign, and it fans out staggered, rate-limited
sends through Ethereal SMTP — surviving restarts, never double-sending.

**Stack:** TypeScript · Express · BullMQ + Redis · Postgres (Prisma) ·
Ethereal SMTP · Elasticsearch (with Postgres fallback) · React + Tailwind

## Demo (2 min)

1. **Compose** — subject, body, lead list (CSV/TXT with live address count),
   start time, delay between sends, hourly cap. Hit Schedule.
2. **Scheduled tab** — rows appear with fire times. Small batches start
   sending within seconds.
3. **Sent tab** — delivered rows with Ethereal preview links proving the send.
4. **Rate limit** — set hourly cap 2, schedule 3: two send, the third waits
   for the next hour (hover its pill for the reason). Connect Slack in
   Settings first and the cap-hit posts a live alert.
5. **Restart** — kill API + worker mid-campaign, restart: due mails send
   exactly once, nothing repeats.

Full 5-minute script (restart drill, load behavior): [`docs/DEMO.md`](docs/DEMO.md).

## Quickstart

```bash
cp .env.example .env && cp .env apps/api/.env   # fill secrets, see below
docker compose up -d postgres redis elasticsearch
npm install
npm --workspace apps/api run db:migrate
npm --workspace apps/api run db:setup     # pg_trgm extension for fallback search
npm --workspace apps/api run db:seed:dev  # dev user + Ethereal senders (needs network)

npm run dev:api      # :4000
npm run dev:worker   # BullMQ worker (separate process)
npm run dev:web      # :5173
```

No Google credentials handy? `DEV_AUTH_BYPASS=true` (local only) skips login
for UI work. No SMTP setup ever — Ethereal test inboxes are minted
automatically on first login; every sent mail stores a preview URL you can
open from its detail page.

Health: `GET localhost:4000/api/health` → `{ ok, db, redis, es }`.
Queue boards: in-app `/queues`, plus bull-board at `/admin/queues` (login-gated).

## How it works

```
[Vite SPA] ──REST + cookie──▶ [Express API] ──▶ Postgres (truth)
                                                    ├─▶ Redis (jobs · quotas · locks)
                                                    ├─▶ Ethereal SMTP (fake sends + previews)
                                                    └─▶ Elasticsearch (search; Postgres fallback)
Local:  BullMQ delayed job fires ──▶ worker ──▶ processOne()
Live:   1-min pinger ──▶ POST /api/worker/tick ──▶ ephemeral Worker ──▶ same processOne()
```

**Scheduling.** `POST /api/campaigns/schedule` staggers `scheduledAt =
startAt + i·delaySec`, bulk-inserts, enqueues one delayed BullMQ job per mail
(`jobId = email.id`, so re-adds dedupe), and bulk-indexes to Elasticsearch.
Retries: 3 attempts, exponential backoff. Zero cron anywhere in the repo.

**Rate limiting (two layers).** Staggered send times preserve order; a BullMQ
`limiter { max: 1, duration: MIN_GAP_MS }` enforces the floor between sends
(2s default, Redis-backed so it holds across workers). Hourly quotas are one
atomic Lua check-and-increment over a global and a per-sender counter (TTL'd,
keyed by UTC hour bucket). Over-cap mails are *delayed into the next hour,
never dropped*. One shared budget per sender per hour across all campaigns —
a campaign's `hourlyLimit` tightens its own rows, it never grants extra.

**Restart safety.** Redis AOF keeps delayed jobs; on boot a reconciler
requeues `scheduled` rows with no live job and resets stale `sending` rows.
Sends are idempotent (`sent` = duplicate-ok, compare-and-set claim, quota
compensation on lost races): at-least-once delivery, never twice.

**Search.** Elasticsearch index (`to^3 / subject^2 / body`) when configured;
otherwise trigram-ranked Postgres, degrading to plain ILIKE. Responses carry
`source: es | db | db-fallback`, and the UI badges the fallback.

**Auth.** Google OAuth via server-side redirect + single-use login ticket
(no cross-site cookies, works in Brave). Email/password with 15-minute
verification links alongside. Sessions are httpOnly JWT cookies.

**Slack alerts.** Connect in Settings (real OAuth). First cap-hit per sender
per hour posts to your channel; unconnected = silent skip, reconnect needs no
redeploy.

## API

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/google` (+ `/google/url`, `/google/callback`, `/google/consume`) · `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/verify-email` · `POST /api/auth/resend-verification` · `GET /api/auth/me` · `POST /api/auth/logout` |
| Senders | `GET /api/senders` · `POST /api/senders` |
| Campaigns | `POST /api/campaigns/schedule` (multipart: `subject`, `body`, `startAt`, `delaySec`, `hourlyLimit`, `to[]`, `leads` file ≤5MB csv/txt, ≤2000/batch) → `{ batchId, total, detected, firstAt, lastAt, estimatedHours, instantSent, note }` |
| Emails | `GET /api/emails?status&q&page` (`status=sent` includes failed) · `GET /api/emails/search` · `GET /api/emails/counts/summary` · `GET /api/emails/:id` · `PATCH /api/emails/:id/star` · `DELETE /api/emails/:id` |
| Slack | `GET /api/slack/connect` · `GET /api/slack/callback` · `GET /api/slack/status` · `DELETE /api/slack/disconnect` |
| Worker | `GET /api/worker/status` · `GET /api/worker/jobs?state=&limit=` · `POST /api/worker/jobs/:id/retry` (failed only) · `POST /api/worker/tick` (secret-guarded) |
| Misc | `GET /api/health` · `GET /admin/queues` (bull-board) |

Errors are JSON (`{ error: { code, message } }`): 400 validation, 401
unauthenticated, 404 unknown, 409 conflicts (duplicate sender, wrong retry
state), 413 oversize upload — never a bare 500 for client mistakes.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres (local Docker, or Neon pooler URL live) | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_URL` | Redis — local `redis://`; live must be Upstash **TCP** `rediss://` (REST breaks BullMQ) | `redis://localhost:6379` |
| `ES_NODE` | Elasticsearch; unset/empty → Postgres fallback | `http://localhost:9200` |
| `JWT_SECRET` / `ENCRYPTION_KEY` | session signing / secret encryption (32+/16+ chars) | — (required) |
| `GOOGLE_CLIENT_ID` (+ `VITE_GOOGLE_CLIENT_ID`), `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google OAuth | — |
| `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Gmail OAuth2 sender for verification mails (must reach real inboxes) | — |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_DEFAULT_CHANNEL_ID` | Slack OAuth + alert channel | — |
| `WORKER_CONCURRENCY` / `MIN_GAP_MS` / `MAX_EMAILS_PER_HOUR_GLOBAL` | worker parallelism / min gap between sends / global hourly cap | `5` / `2000` / `200` |
| `STALE_SENDING_MINUTES` / `ETHEREAL_POOL_SIZE` | stuck-send reset window / senders per user | `5` / `2` |
| `CRON_SECRET` | guards `POST /api/worker/tick` | — |
| `DEV_AUTH_BYPASS` / `DEV_USER_EMAIL` | local no-OAuth UI (dev only, never prod) | `false` |

Config is validated at boot — a misconfigured server refuses to start
half-working.

## Deploy (live, $0)

- **Web** (Vercel, `vercel.web.json`): `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`.
- **API** (Vercel, `vercel.api.json`, `serverless.ts`): Neon URL (pooler),
  Upstash TCP URL, `ES_NODE` (or empty), OAuth/Slack vars, `FRONTEND_URL`
  (`SameSite=None;Secure` cookies in prod), `CRON_SECRET`.
- **Waker** (repo has zero cron schedules, per spec): ping
  `POST {API}/api/worker/tick?limit=25` every minute — cron-job.org (free) or
  any poller. Small batches also send inline during the schedule call.
  Vercel Cron can't do this (Hobby is daily-only).
- Live limits: ~500/batch, 4MB uploads (10s/4.5MB function caps), ~1-minute
  timing granularity.

## Trade-offs

At-least-once delivery, best-effort order across hour boundaries (documented
honestly, covered by test). ES is dual-written, not outbox-pattern — a
`reindex` script repairs drift. Single `email-send` queue (colons are illegal
in BullMQ ≥5 names). JWT cookies without rotation. Vite SPA instead of Next
(no SSR need). Quota reservation happens before the row claim (fail-closed:
a crash costs a slot, never an overshoot).

## Verification

`npm run typecheck` (×3) · `npm run test` (contract + unit, real infra, no
mocks) · `npm run build`. E2E evidence (schedule→send→preview, caps, restart
survival, search fallback, retry, star/delete) and load notes
(`bulk-schedule --count=1000`): [`docs/`](docs/).

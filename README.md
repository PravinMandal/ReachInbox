# ReachInbox

Email scheduler with a dashboard. Compose a campaign and it fans out staggered, rate-limited sends through Ethereal SMTP. Restarts do not lose jobs. Sends never duplicate.

TypeScript, Express, BullMQ + Redis, Postgres with Prisma, React + Tailwind.

## Contents

- [Try it](#try-it)
- [Run it](#run-it)
- [How sending works](#how-sending-works)
- [API](#api)
- [Settings](#settings)
- [Deploy](#deploy)
- [Decisions](#decisions)
- [Checks](#checks)

## Try it

1. Open Compose. Add a subject, a body, and a lead list. A CSV or TXT upload shows the detected address count.
2. Set a start time, a delay between sends, and an hourly cap. Click Schedule.
3. The Scheduled tab lists each mail with its fire time. Small batches start sending within seconds.
4. The Sent tab shows delivered rows. Each links to an Ethereal preview that proves the send.
5. To see rate limiting: set hourly cap to 2 and schedule 3 mails. Two send. The third waits for the next hour. Hover its time pill for the reason. Connect Slack in Settings first and the cap hit posts a live alert.
6. To see restart recovery: stop the API and worker mid-campaign, then start them again. Due mails send exactly once.

The full 5 minute demo script, including the restart drill and load behavior, is in [docs/DEMO.md][demo].

## Run it

```bash
cp .env.example .env && cp .env apps/api/.env
docker compose up -d postgres redis elasticsearch
npm install
npm --workspace apps/api run db:migrate
npm --workspace apps/api run db:setup
npm --workspace apps/api run db:seed:dev

npm run dev:api       # :4000
npm run dev:worker    # BullMQ worker, separate process
npm run dev:web       # :5173
```

`db:setup` installs the `pg_trgm` extension used by fallback search.
`db:seed:dev` creates a dev user and Ethereal senders. It needs network.

No Google credentials on hand: set `DEV_AUTH_BYPASS=true` for local UI work. It never applies in production. No SMTP setup is needed at any point. Ethereal test inboxes are created on first login and each sent mail stores a preview URL.

Health check: `GET localhost:4000/api/health` returns `{ ok, db, redis, es }`.
Queue boards: in-app `/queues`, and bull-board at `/admin/queues` behind login.

## How sending works

The web app posts a campaign to the API. The API staggers one fire time per recipient, inserts the rows, enqueues one delayed BullMQ job per mail with the row id as the job id, and bulk-indexes the rows for search. Retries use 3 attempts with exponential backoff. The repo contains no cron in any form.

```
SPA --REST + cookie--> API --> Postgres (source of truth)
                            --> Redis (jobs, quotas, locks)
                            --> Ethereal SMTP (sends, previews)
                            --> Elasticsearch (search, optional)

Local:  delayed job fires -> worker -> processOne()
Live:   1-minute pinger -> POST /api/worker/tick -> short-lived worker -> same processOne()
```

Rate limiting has two parts. Staggered fire times keep order. A BullMQ limiter sets the floor between sends (`MIN_GAP_MS`, 2 seconds by default, stored in Redis so it holds across workers). Hourly quotas are one atomic Lua check-and-increment over a global counter and a per-sender counter, keyed by UTC hour and expired after the hour. A mail over quota is delayed into the next hour with its order offset kept. Nothing is dropped. The per-sender budget is shared across all campaigns of that sender. A campaign `hourlyLimit` tightens its own rows only.

Restart recovery has two parts. Redis append-only persistence keeps delayed jobs. On boot a reconciler requeues `scheduled` rows that have no live job and resets `sending` rows older than `STALE_SENDING_MINUTES`. Sends are idempotent: a `sent` row is a no-op on redelivery, the claim is compare-and-set, and a lost race returns its quota slot. Delivery is at-least-once and never twice.

Search uses Elasticsearch (`to`, `subject`, `body` with field boosts) when `ES_NODE` is set. Otherwise it falls back to trigram-ranked Postgres, then plain ILIKE. Every response names its source (`es`, `db`, `db-fallback`) and the UI badges the fallback.

Auth uses Google OAuth through a server-side redirect plus a single-use login ticket, so no cross-site cookie is written. Email and password with 15 minute verification links works alongside it. Sessions are httpOnly JWT cookies.

## API

Auth: `POST /api/auth/google`, `GET /api/auth/google/url`, `GET /api/auth/google/callback`, `POST /api/auth/google/consume`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/verify-email`, `POST /api/auth/resend-verification`, `GET /api/auth/me`, `POST /api/auth/logout`

Campaigns: `POST /api/campaigns/schedule` takes multipart `subject`, `body`, `startAt`, `delaySec`, `hourlyLimit`, `to` and a `leads` file (CSV or TXT, 5 MB local, 4 MB live, 2000 recipients local, 500 live). It returns `batchId`, `total`, `detected`, `firstAt`, `lastAt`, `estimatedHours`, `instantSent`, `note`.

Mail: `GET /api/emails` with `status`, `q`, `page`, `limit`, `sort`, `order`. The `sent` status covers sent and failed rows. Also `GET /api/emails/search`, `GET /api/emails/counts/summary`, `GET /api/emails/:id`, `PATCH /api/emails/:id/star`, `DELETE /api/emails/:id`.

Slack: `GET /api/slack/connect`, `GET /api/slack/callback`, `GET /api/slack/status`, `DELETE /api/slack/disconnect`.

Worker: `GET /api/worker/status`, `GET /api/worker/jobs` with `state` and `limit`, `POST /api/worker/jobs/:id/retry` for failed jobs only, `POST /api/worker/tick` guarded by `CRON_SECRET`.

Errors are JSON as `{ error: { code, message } }`. Client mistakes return 400, 401, 404, 409 or 413. The server returns 500 only for its own failures.

## Settings

All values come from the environment and are validated at boot. A bad value stops the server with a plain message instead of starting half working.

`DATABASE_URL`: Postgres. Local Docker, or a Neon pooler URL live.
`REDIS_URL`: Redis. Local `redis://`. Live must be Upstash TCP `rediss://`; the REST API does not support BullMQ.
`ES_NODE`: Elasticsearch. Empty means Postgres fallback.
`JWT_SECRET`, `ENCRYPTION_KEY`: session signing and secret encryption. 32 or more chars and 16 or more chars.
`GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: Google OAuth.
`GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`: Gmail sender for verification mails, which must reach real inboxes.
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_DEFAULT_CHANNEL_ID`: Slack OAuth and alert channel.
`WORKER_CONCURRENCY`, `MIN_GAP_MS`, `MAX_EMAILS_PER_HOUR_GLOBAL`: worker parallelism, minimum gap between sends, global hourly cap. Defaults 5, 2000, 200.
`STALE_SENDING_MINUTES`, `ETHEREAL_POOL_SIZE`: stuck-send reset window and senders per user. Defaults 5, 2.
`CRON_SECRET`: guards the tick endpoint.
`DEV_AUTH_BYPASS`, `DEV_USER_EMAIL`: local UI without OAuth. Dev only.

## Deploy

The live setup runs at zero cost: two Vercel projects, Neon Postgres, Upstash Redis.

Web uses [vercel.web.json][webconf]. It needs `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`.

API uses [vercel.api.json][apiconf] with `serverless.ts` as entry. It needs the Neon URL, the Upstash TCP URL, `ES_NODE` or blank, the OAuth and Slack values, `FRONTEND_URL`, and `CRON_SECRET`. Cookies are `SameSite=None;Secure` in production.

Live has no persistent worker, so an external pinger calls the tick endpoint once a minute. Any poller works; cron-job.org on the free tier is enough. Small batches also send inline during the schedule call and report `instantSent`. Vercel Cron cannot do this because Hobby projects only allow daily schedules.

Live caps: about 500 recipients per batch, 4 MB uploads, 10 second function budget, roughly 1 minute timing granularity.

## Decisions

Single `email-send` queue: BullMQ forbids colons in queue names. The limiter stays as a backstop behind staggered times. Quota is reserved before the row is claimed, so a crash costs a slot instead of overshooting. Search writes go directly to Elasticsearch with a `reindex` script for drift, not the outbox pattern. Slack uses `chat.postMessage` rather than webhooks. The frontend is a Vite SPA because nothing needs server rendering. Prisma for migration ergonomics. Google login uses a ticket because a cookie written cross-site is dropped by browsers. The pinger is external because Hobby has no sub-daily cron.

Email and password auth exists next to Google auth. Figma screenshots stand in for the design spec. Hour buckets are UTC. Ethereal can return the same test credentials for rapid repeat calls; rows stay distinct because sending identity is the From header and quota keys are per sender. Dev bypass is local only.

## Checks

`npm run typecheck` covers shared, API and web. `npm run test` runs contract and unit tests against real infrastructure, no mocks. `npm run build` builds all three. Scheduling, previews, caps, restart survival, search fallback, retry, star and delete are covered end to end, with notes in [docs/][docs].

[demo]: docs/DEMO.md
[docs]: docs/
[webconf]: vercel.web.json
[apiconf]: vercel.api.json

# Deployment handoff — Vercel ($0) + GitHub

> For the deploy agent. Secrets are NEVER in this file. Live secret locations:
> - `/home/pravin/Projects/ReachInbox/.env.live` (gitignored, mode 600) —
>   `REDIS_URL` (Upstash TCP, tested: Lua/streams/SETNX OK) + live Neon `DATABASE_URL`.
> - `/home/pravin/Projects/ReachInbox/apps/api/.env` — Google/Slack/Gmail/JWT secrets.
> - `/home/pravin/Projects/ReachInbox/apps/web/.env` — `VITE_GOOGLE_CLIENT_ID`.
> - Vercel token + GitHub PAT come from the user directly in chat.

## 0. Read first (in order)

1. `/home/pravin/Projects/ReachInbox/README.md` — product + env table + live limits.
2. `/home/pravin/Projects/ReachInbox/learnings.md` + `docs/ACTIONS.md` (build log),
   `docs/ASSUMPTIONS.md`, `docs/TRADEOFFS.md` — why every decision was made.
3. `/home/pravin/.opencode/plan/plan.md` — final architecture (two runtimes!).
4. `vercel.web.json`, `vercel.api.json`, `.github/workflows/tick.yml` — deploy configs.

## 1. Current state (already done — do NOT redo)

- [x] Upstash Redis **tested from this machine**: PING + Lua quota + streams + SETNX.
- [x] Live Neon `reachinbox` DB (inside the SellStuffs project, isolated database):
  `prisma migrate deploy` applied + `db:setup` (pg_trgm + GIN indexes) done.
  Do NOT run `migrate dev` against live; `deploy` only, and only if new migrations appear.
- [x] `tsc` clean ×3, `vite build` ok, vitest 13/13 (when last run).
- [ ] Git init/commit/push + collaborators + Vercel projects + envs + smoke test (YOU).

## 2. GitHub

```bash
cd /home/pravin/Projects/ReachInbox
git init && git add -A && git status   # confirm NO .env* files listed (.gitignore covers .env, .env.local, .env.live)
git commit -m "ReachInbox email scheduler — Yarub(optional): keep history clean"  # keep message simple/professional
gh repo create ReachInbox --private --source=. --push   # or API: POST /user/repos {name, private:true} then push
gh api repos/{owner}/ReachInbox/collaborators/Mitrajit -X PUT
gh api repos/{owner}/ReachInbox/collaborators/Yadav036 -X PUT
```

Then GitHub Actions secrets (repo → Settings → Secrets → Actions, or `gh secret set`):
- `LIVE_API_URL` = `https://<api-project>.vercel.app` (after §3)
- `CRON_SECRET` = generate: `openssl rand -hex 32` (also set as Vercel env on api)

## 3. Vercel — TWO projects from ONE repo

| | Web | API |
|---|---|---|
| Import | same `ReachInbox` repo | same repo, second project |
| Build command | `npm --workspace packages/shared run build && npm --workspace apps/web run build` | default (see `vercel.api.json`) |
| Output dir | `apps/web/dist` | — (serverless, `serverless.ts`) |
| Env | `VITE_API_URL=https://<api>`, `VITE_GOOGLE_CLIENT_ID=<same as web .env>` | see table below |

API env (copy values from `.env.live` + `apps/api/.env` — never echo them to logs):
`DATABASE_URL` (live Neon + `?pgbouncer=true&connection_limit=1`), `REDIS_URL` (Upstash
`rediss://`, TCP only), `ES_NODE` (leave **empty** → Postgres fallback), `JWT_SECRET`,
`ENCRYPTION_KEY`, `FRONTEND_URL=https://<web>`, `GOOGLE_CLIENT_ID`,
`GOOGLE_REDIRECT_URI=https://<api>/api/auth/google/callback` (**api host** — the
callback mints a same-origin-redeemed login ticket, so the api URI is the only one
that ever needs registering; web-five URI additionally registered is harmless), `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI=https://<api>/api/slack/callback`,
`SLACK_DEFAULT_CHANNEL_ID`, `WORKER_CONCURRENCY=5`, `MIN_GAP_MS=2000`,
`MAX_EMAILS_PER_HOUR_GLOBAL=200`, `CRON_SECRET`. `NODE_ENV=production`.
(`GMAIL_*` only if verification mail must work live — copy too, harmless.)

After both deploy, update Google OAuth authorized origins (`https://<web>`) and Slack
redirect URI (already set to the `<api>` URL above) in their consoles — needs the
user's browser; flag it if URLs differ from placeholders.

## 4. Verify live (all must pass)

```bash
API=https://<api-project>.vercel.app
curl -s $API/api/health                                     # {ok:true,...}
curl -s -X POST $API/api/worker/tick -H "Authorization: Bearer $CRON_SECRET"  # {processed...}
# In browser: Google login → compose 5 → scheduled → (pinger ≤10min) sent → search → /queues live
```

## 5. Hard constraints (violating these breaks the build)

- **No Vercel Cron.** Hobby is daily-only; sub-daily schedules FAIL deployment.
  The waker is `.github/workflows/tick.yml` (external). Do not add `crons`.
- **Upstash TCP only** (`rediss://`). REST/KV URLs break BullMQ (Lua/streams).
- **ES empty = correct.** Fallback search is tested; do not "fix" by adding ES.
- Never commit `.env*`. Never run `migrate dev` on Neon. Never enable `DEV_AUTH_BYPASS` in prod.
- Vercel limits: 10s functions, 4.5MB payloads (4MB upload cap already coded).

## 6. Report back

Live web URL, live api URL, health output, tick output, collaborator invite states,
and anything that deviated from this file (append to `docs/ACTIONS.md`).

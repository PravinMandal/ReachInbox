# Actions log (append-only — newest at bottom)

> After a compact, this file tells the next agent what was built, verified, TODO.

## 2026-09-27 — Boot (TS-everywhere, Vercel-free)

- [x] Re-read `problemStatement.md` + all 7 design screenshots + final plan
  (`/home/pravin/.opencode/plan/plan.md`). Env: node v26.8.1, npm 11, docker 29.7.
- [x] Created `learnings.md` + `docs/` (ACTIONS/ASSUMPTIONS/TRADEOFFS). Reason:
  user demanded full traceability + anti-hallucination across compacts.
- [x] Scaffold monorepo (root, shared TS, api TS, web TS, compose, Vercel configs).
  `apps/api` typechecks clean (fixed ioredis/pino-http/bull-board type skews).
- [ ] Apply 4 restart amendments (reason: deep-research review 2026-09-28):
  1) external pinger instead of Vercel Cron (Hobby daily-only, verified in docs);
  2) sonner/cva/RHF instead of hand-rolled UI; 3) pinned vitest+supertest;
  4) pg_trgm fallback-search migration.
- [ ] Verify: install, prisma generate, `tsc --noEmit` (api+web+shared),
  `vite build`, `vitest run`, `docker compose up pg/redis/es`, migrate + smoke
  schedule→send (Ethereal) + restart + rate-limit + search fallback.
- [ ] Playwright e2e (user connected MCP): login(dev-bypass)→compose→scheduled→
  sent→search→restart→rate-limit+Slack(mock)→previewUrl. Hunt + fix bugs.
- [ ] README + demo script. Real OAuth/Slack/DB creds from user at very end —
  never block build on secrets (placeholders + `DEV_AUTH_BYPASS` local flag).

## 2026-09-28 — Deep-research review (from-scratch audit)

- Verified via web: Vercel Hobby cron daily-only (sub-daily fails deploy) →
  plan bug fixed to external pinger (GHA */10 `.github/workflows/tick.yml`).
  Upstash free 500K cmds/mo + Neon free 0.5GB/100CU-h confirmed sufficient.
- Decision: no restart. Vite SPA, Express, single queue, Prisma, Upstash-TCP,
  ES+fallback all re-confirmed. Only the 4 amendments above.
  Why logged: user asked "if we start again, what changes" — answer recorded here
  to prevent re-litigating stack choices after compacts.

## 2026-09-28 — Email+password auth (MoonSeek pattern) + real identity fix

- User report: logged in but sidebar showed `oliver.brown@domain.io`. Root cause:
  `DEV_AUTH_BYPASS=true` short-circuited `/me` to the stub. Fix: bypass OFF
  (real JWT flow); verified sidebar shows the actual account identity.
- Studied `120-MoonSeek` (mongoose/bcrypt/JWT-verify-mail/Gmail-OAuth2) and ported
  semantics to our stack: `passwordHash?` + `isVerified` (migration
  `20260928_password_auth` + backfill Google users verified), `googleId` now
  nullable; bcryptjs cost 10; verify JWT `{sub, purpose:email_verify}` 15m;
  Gmail OAuth2 sender (`GMAIL_*` env, Ethereal deliberately NOT used — it never
  delivers); non-blocking send + `POST /resend-verification` (always 200).
- Endpoints: `POST /register` (201/409) → `GET /verify-email?token=` (sets cookie)
  → `POST /login` (401 uniform / 403 unverified) — all under the existing 30/min
  limiter. Google flow untouched.
- Frontend: real signin/signup forms (RHF + shared zod), pending-inbox screen,
  `/verify-email` route with ok/bad states. Fixed RHF `ref` crash (`Input` is now
  `forwardRef`) and a stale-vite red herring on the new route.
- Verified end-to-end in-browser: signup → pending → verify → dashboard shows
  `Real User / realuser@ex.io`; curl matrix 201/409/403/401/verify/login/me.

## 2026-09-28 — Sidebar/header polish (user screenshots)

- Brand moved to navbar (header, all sizes; removed from sidebar body). Logo mark
  is `#E0E0E2` (dark-surface design) → wrapped in a dark brand tile so it is
  crisp in both themes. Verified via light screenshot.
- Settings pinned to sidebar bottom (`mt-auto` group). Queues stays under CORE.
- Fixed double-highlight: NavLink matches pathname only, so `/?tab=scheduled`
  and `/?tab=sent` were BOTH active. Active state now computed from
  `useLocation + useSearchParams` — verified lit-only-active on both tabs.

- Agreed with user: no roles exist (everyone is admin of their own account), so
  the queue dashboard belongs in-app, not a new tab. Built `/queues`: live
  counts, per-state tabs, per-user job rows (jobId=email.id filtered by userId),
  retry for failed, 3s polling; API `GET /worker/jobs`, `POST /jobs/:id/retry`
  (ownership-checked), extended `/status`. bull-board stays mounted for advanced
  debugging (spec's "live BullMQ dashboard" satisfied twice).
- Theme toggle now a View-Transitions circle wipe from the click point
  (`--tx/--ty` + `theme-wipe` keyframes; instant fallback + reduced-motion off).
  Verified flipping both ways, 0 errors; dark Queues screenshot reviewed.
- [x] Re-scan: `tsc` ×3 clean; jobs endpoint scoped (bogus state→delayed,
  foreign retry→404); 30 completed rows render; counts live.

## 2026-09-28 — UI correctness pass (user bug reports, all fair)

- [x] Login card centered (`min-h-screen grid place-items-center`). Why: it
  rendered top-left — LoginPage had no centering wrapper.
- [x] Real TipTap editor (B/I/U/S, headings, align, lists, quote, code, link,
  undo/redo) replacing static toolbar. Backend sanitize allowlist + `html` MIME
  part (+ text fallback); detail renders formatted HTML. Why: static icons were
  dishonest UI — every visible control must work.
- [x] `AppShell`: top header with theme toggle + logout icon buttons; removed text
  buttons from sidebar. Sidebar: REACHINBOX logo (real SVG vendored to
  `public/logo.svg`, also favicon). Mobile drawer + responsive paddings/stack.
  Why: user review + spec §dashboard. (Queues link later became in-app `/queues`.)
- [ ] Re-verify all (below).
  - [x] Re-scan (Playwright, 0 console/page errors): login centered (measured),
    header toggle+logout icons, REACHINBOX logo + Queues link, bold→`<strong>` +
    list→`<ul>`, CSV count hint, RHF validation, formatted campaign → HTML stored
    (`<em>` intact) + sent + previewUrl, detail renders `<em>`, XSS probe
    (script/onclick stripped, safe link kept), mobile 390px drawer, search,
    dark/light both ways. `tsc` ×3 + `vite build` green.

- [x] `.github/workflows/tick.yml` (GHA */10 external pinger). Why: Hobby cron
  daily-only, verified in Vercel docs.
- [x] UI libs: `sonner` + `cva`/`clsx`/`tailwind-merge` + `react-hook-form`/`resolvers`;
  deleted hand-rolled `Toast.tsx`; RHF+zod Compose; cva Button. Why: user "use
  libraries, no clutter" instruction.
- [x] Pinned `vitest` (+`supertest`): shared 5 tests + api 3 tests pass.
- [x] `tsc --noEmit` clean (shared/api/web) + `vite build` ok (fixed RHF
  input/output generics, `vite/client` types).
- [ ] Infra: `docker compose up -d postgres redis elasticsearch` → migrate (+pg_trgm).
  - [x] Infra up (sudo needed — user gave password; group fix deferred). Init
    migration applied; bogus auto `DROP INDEX` migration removed via
    `migrate reset` (raw-SQL drift lesson → `db:setup` script instead).
  - [x] `db:setup` (pg_trgm + 2 GIN indexes) done. `pino-pretty` added (logger
    assumed it). Dev Ethereal pool seeded (2 senders).
  - [x] Bugs found+fixed: BullMQ 5.81 rejects `:` in queue names → `email-send`
    (plan/docs updated); ES `null_value:"NULL"` invalid on dates → dropped;
    `ensureIndex` boot race → retry+backoff; auto-created wrong mapping
    (userId:text) → deleted, recreated keyword, reindexed.
  - [x] Smoke: 5 scheduled → 5 sent with real previewUrls; ES search `es/5`.
    Verified Ethereal API dedupes rapid test accounts (documented, acceptable).
- [ ] Boot api+worker, smoke: schedule→send (Ethereal), restart, rate-limit, search.
- [ ] Playwright e2e full pass, bug hunt + fixes.
  - [x] Playwright MCP e2e (0 console errors): inbox tabs/counts (Scheduled 2,
    Sent 13), compose RHF + CSV count hint + inline validation + sonner toast +
    redirect, detail delivery + previewUrl, settings/Slack, search filters,
    login page, dark/light toggle. Fixed: favicon 404.
  - [x] Backend e2e: limiter Δ≈2s (processedOn), cap-2/hr → delay-to-next-hour +
    rollover fire, node restart + redis restart → exactly-once sends,
    ES + trigram fallback, bull-board 200, bulk-schedule JSON path (10/10).
  - Bugs fixed this session: queue colon rename, ES null_value, ensureIndex race,
    wrong auto-mapping + reindex, pino-pretty dep, Ethereal dedupe doc, worker
    `delayed` event log.
- [x] README + `docs/DEMO.md` video script. Real OAuth/Slack/DB creds from user
  at very end — Slack live-notify is the one unverified live call (silent-skip
  verified); demo video covers it once creds land.

## 2026-09-28 — Live-backend prep + deployment handoff

- Upstash URL (user-supplied) tested from here: PING + exact Lua quota + streams
  + SETNX. First attempt failed on my explicit `tls:{}` + short timeout; plain
  URL-parsed TLS + 15s timeout connects. Stored in `.env.live` (gitignored, 600;
  had to quote values — raw `&` breaks shell sourcing).
- Moodify Redis is dead (DNS NXDOMAIN) — discarded. No Upstash anywhere else.
- SellStuffs Neon works; created isolated `reachinbox` DB; `migrate deploy` +
  `db:setup` (pg_trgm) applied to live. Deploy agent must NOT re-run `migrate dev`.
- Wrote `docs/deployment.md` (no secrets — locations only) for the deploy agent
  holding Vercel+GitHub creds: read-order, GitHub+collaborators, two Vercel
  projects, env tables, verify checklist, hard constraints.

## 2026-09-28 — Live deploy (GitHub + Vercel, $0)

- [x] Local git init + 8 clean commits, pushed to private `PravinMandal/ReachInbox`
  (branch `master`). Verified no `.env*` tracked (only `.env.example` files).
  Playwright debug dumps excluded via `.gitignore`.
- [x] Invited `Mitrajit` + `Yadav036` (push) — both invites pending acceptance.
- [x] Fixed `.github/workflows/tick.yml` auth header (`Bearer *** ...` →
  `Bearer ${{ secrets.CRON_SECRET }}`); was dead on arrival otherwise.
- [x] Vercel projects (Hobby team, CLI-deployed, unlinked to git — pushes do NOT
  auto-deploy; redeploy via `vercel --prod --local-config vercel.{api,web}.json`):
  `reachinbox-api` → `https://reachinbox-api.vercel.app`,
  `reachinbox-web` → `https://reachinbox-web-five.vercel.app`
  (bare `reachinbox-web` alias taken by another account).
- [x] API env per deployment.md §3 (values from `.env.live` + `apps/api/.env`);
  `ES_NODE` omitted (fallback by design), `DEV_AUTH_BYPASS` never set.
  `CRON_SECRET` generated (`openssl rand -hex 32`), also stored as GH secret.
  `GOOGLE_CLIENT_ID` == `VITE_GOOGLE_CLIENT_ID` verified (match).
- Deviations from `docs/deployment.md` (deploy-driven, no product-code refactors):
  1) root `postinstall` (shared build + `prisma generate`) — legacy `builds`
     ignore the project's custom installCommand, so the generated client was
     missing at runtime (`@prisma/client did not initialize yet`).
  2) `sanitize-html` pinned `2.12.1` (htmlparser2 v8, CJS) — v2.17 pulls
     ESM-only htmlparser2@12 and Vercel's launcher cannot `require(esm)`
     (Node>=22 bump attempted first, reverted — did not help). Verified
     locally: tsc + vitest + XSS-strip smoke.
  3) explicit `@bull-board/ui` dep + static `package.json` import in `app.ts` —
     `@bull-board/api` resolves it via eval'd `require.resolve`, invisible to
     the serverless file tracer (`Cannot find module '@bull-board/ui/...'`).
  4) Added `.vercelignore` (keeps local `.env*` out of CLI uploads).
- [x] Verify: `/api/health` → `{"ok":true,"db":"up","redis":"up","es":"down",
  "esDegraded":true}`; tick without secret → `UNAUTHORIZED`, with secret →
  `{"processed":0,"sent":0,"delayed":0}`; web 200 with API URL + GIS baked in.
- [x] GH Actions secrets `LIVE_API_URL` + `CRON_SECRET` set.
- [ ] BLOCKED: Actions cannot run — account billing flag ("payments have failed
  or spending limit needs increase", run 36336724235 never started). Waker
  works (tick verified by curl) but needs a runner: fix billing, make the repo
  public (unlimited free minutes), or point cron-job.org @1min at
  `POST {API}/api/worker/tick?limit=25` with `Authorization: Bearer <CRON_SECRET>`.
- [ ] USER: Google console add origin `https://reachinbox-web-five.vercel.app`;
  Slack console confirm redirect `https://reachinbox-api.vercel.app/api/slack/callback`.
- [ ] USER (browser pass, needs Google click): login → compose 5 → scheduled →
  sent (after waker fires) → search → `/queues` live.

## 2026-09-28 — Auth fixes (live sign-in/Google/verification)

- Root causes (all three reported symptoms): (1) SPA had no fallback rewrite,
  so `/login`, `/verify-email`, etc. returned Vercel 404 — fixed with
  `vercel.web.json` rewrite `/(.*) → /`, redeployed, all routes 200.
  (2) Gmail refresh token dead (`invalid_grant` on direct refresh test) — user
  regenerated via OAuth Playground; new token set on api env + local
  `apps/api/.env` synced, refresh re-tested OK, api redeployed.
  (3) Google button: backend IDs match; user added the live origin in the
  Google console. Awaiting user browser retest.
- Backend was never broken: CORS/cookies correct, login + Google endpoints
  respond properly, user's Brave was already reaching the API (`/me` 401
  pre-login as expected).

## 2026-09-28 — Google login via server redirect (GIS popup abandoned)

- Why: GIS button iframe stayed 0x0 in every browser with zero backend contact
  (inline placeholder visible, clicks dead). Origin entry verified correct on
  the right client, no CSP, React 18, lib current — root cause unprovable
  remotely, so replaced the mechanism instead of the config.
- New flow: `GET /api/auth/google/url` (state cookie + auth URL) → Google →
  `GET /api/auth/google/callback` (state check, code exchange, same
  verify/upsert/cookie as before, 302 to `/?login=google`) → inbox toast.
  Frontend GIS button/provider removed (`@react-oauth/google` uninstalled);
  plain redirect button instead. Legacy `POST /api/auth/google` kept.
- Env: new `GOOGLE_REDIRECT_URI` (`.env.example` + local `.env` + Vercel api).
  Verified: `/google/url` well-formed; Google answers `redirect_uri_mismatch`
  naming exactly `https://reachinbox-api.vercel.app/api/auth/google/callback`
  — expected until the user registers it.
- [ ] USER: console → Authorized redirect URIs → add
  `https://reachinbox-api.vercel.app/api/auth/google/callback` → Save →
  wait ~5min → click Sign in with Google.

## Conventions

- Every entry: `[date] what + why + verify + result`.
- Re-read on resume: `learnings.md`, this file, ASSUMPTIONS, TRADEOFFS, plan.md,
  problemStatement.md.

# Assumptions (explicit — also in README)

1. **Figma = screenshots.** No live Figma URL provided; `Design Images/*.png`
   is the visual spec. Close match + polish (dark mode, toasts, skeletons) accepted.
2. **Login = Google OAuth + email/password.** Both set the same JWT cookie.
   Password accounts require email verification (15m JWT link, Gmail OAuth2 mail
   — Ethereal can't deliver to real inboxes). Google accounts are implicitly
   verified. No password auth was visual-only in early builds; since 2026-09-28
   the Email/Password fields are fully functional (mirrors the MoonSeek project).
3. **Senders = Ethereal test accounts.** `ETHEREAL_POOL_SIZE=2` auto-created via
   `nodemailer.createTestAccount()`, stored in `Sender`. "Multiple senders" =
   these + optional custom SMTP via `POST /api/senders`. `previewUrl` is the proof.
   Verified 2026-09-28: Ethereal's API currently returns identical SMTP creds for
   rapid repeat calls — Sender rows still differ (From + quota keys), which is what
   the demo exercises; acceptable for fake SMTP, noted in code.
4. **Compose toolbar is a real editor.** TipTap (bold/italic/underline/strike,
   headings, align, lists, quote, code, link, undo/redo) — every button works.
   Body stored/sent as sanitized HTML (+ plain-text fallback part). Figma
   attachments (tennis PNG) = Ethereal `previewUrl` card, not MIME in v1.
5. **Hour buckets are UTC.** `YYYYMMDDHH` UTC for global + per-sender counters.
   UI shows browser-local times, DB stores UTC.
6. **Single ES node, security off (dev).** `xpack.security.enabled=false`, 512MB
   heap. Prod/live: Bonsai sandbox or unset → automatic Postgres fallback.
7. **Slack channel = one ID.** `SLACK_DEFAULT_CHANNEL_ID` env, stored per-user on
   connect. No channel picker (scope cut).
8. **Caps:** 2000 recipients/batch local, ~500 live (Vercel 10s timeout).
   CSV/TXT 5MB local, 4MB live (Vercel 4.5MB payload). Over → `400` with counts.
9. **Auth = JWT cookie 7d.** `Authorization: Bearer` also accepted (Postman).
   No refresh rotation in v1.
10. **Ordering best-effort.** Concurrent workers + rescheduling can reorder;
    index-offset delays preserve input order best-effort only.
11. **At-least-once delivery.** Crash between SMTP-accept and `mark sent` may
    double-send. CAS + jobId dedups best-effort.
12. **Creds at end.** Google/Slack/Neon/Upstash/Bonsai placeholders until user
    supplies them. Build never blocks (`DEV_AUTH_BYPASS` local UI flag, off default).
13. **Vercel live = adaptation.** Graded Docker path uses zero cron; live tick is
    driven by an external free pinger (GitHub Actions `*/10`, or cron-job.org @1min)
    — NOT Vercel Cron, which is daily-only on Hobby and fails deploy otherwise.
    Live granularity ~5–10 min.

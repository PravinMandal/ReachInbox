# Demo video script (≤5 min) — record against Docker, plus 30s live clip

Setup before recording: infra up, api+worker+web running, `DEV_AUTH_BYPASS=true`
(or real Google login), Ethereal pool seeded, Slack connected in a second window
(if creds available; else show Settings → Connect screen + note silent-skip).

## 0:00–0:45 — Schedule from the frontend
1. Inbox (empty scheduled tab → empty state).
2. Compose → From dropdown → type 2 To addresses → Upload List (leads.csv) →
   show "2 typed + 3 from file" count → subject/body → Delay 2, Hourly 200 →
   Send Later → pick start ~1 min out → Schedule → sonner toast "Scheduled 5".
3. Scheduled tab fills with orange time pills.

## 0:45–1:30 — Dashboard + search + bull-board
1. Wait for sends (jump-cut) → Sent tab, grey pills, counts update (sidebar).
2. Search "campaign" → rows filter (note `source:es` in Network tab, 1 line).
3. Open a row → detail with Delivery + Ethereal `previewUrl` → open preview in browser.
4. `/admin/queues` → completed/delayed counts moving live.

## 1:30–2:30 — Restart survival
1. Schedule 2 emails +60s. `pkill` api + worker (show terminal, DOWN health).
2. Wait past due time (jump-cut). Restart both → worker log `reconcile` →
   both send exactly once (DB: 2 rows `sent`, distinct previewUrls).

## 2:30–3:45 — Rate limit under load (+ Slack)
1. `bulk-schedule --count=10 --hourly=2` (or compose Hourly Limit 2) →
   response `estimatedHours≈5`.
2. First 2 send; rest stay `scheduled` with `scheduledAt` bumped to next hour
   (show DB/Redis delayed scores). No failures, no drops.
3. Slack channel shows **one** "Hourly email limit hit" message (dedupe proof:
   no second message for later hits in the same hour).
4. Next hour rollover (jump-cut or short cap window) → next 2 send.

## 3:45–4:30 — Fallback + dark mode + close
1. `docker stop elasticsearch` → search still returns rows (`source:db-fallback`
   banner in UI) → `docker start` → back to `es`.
2. Toggle dark mode. 30s live Vercel clip (if deployed): schedule 5, external
   pinger tick fires ≤10min, same dashboard.
3. Close: " assumptions/tradeoffs in README §8; repo + creds in description."

---
name: project-module-functions
description: What each slice and shell feature does (reports, transport, notifications, backups, sessions) and key rules
type: project
---

- **reports** (`reports.submit` org, `reports.review` platform, catalogue/settings perms): monthly store reports, product
  catalogue+prices, XLSX import/export, submit/lock/unlock with signatures. Submitting notifies `reports.review` holders.
- **transport** (`transport.orders.create` org, `.manage`/`.view_all` platform): orders per deceased with delivery and/or
  carriers part; statuses submitted->accepted->in_progress->done, rejected/cancelled, **bumped**. Car lock: same car
  (normalised number) within `CarLock`=2h of an active order -> 409 (crosses midnight). **Military** orders (`is_military`)
  bump ordinary orders (not other military ones, not in_progress); bumped order keeps data, desk edits -> back to submitted.
  **Dates & indication (2026-11-07, user request):** orders always had `service_date`, but the page showed one day only,
  so users thought dates were missing. Now: a 14-day strip (`DateStrip`, counts from `GET /transport/days`: total/open/
  attention, attention = submitted for `manage`, bumped for a desk), a red notice for open orders on past days (60 days
  back), «Попереду в роботі» chips for open orders up to 120 days ahead (paid now, buried in a week: must not get lost),
  timing badge per order (Терміново · сьогодні / Завтра / Післязавтра / Через N днів / Не закрито), groups «У роботі»
  (submitted, accepted, in_progress, bumped) vs «Закриті». Stored status codes unchanged; `in_progress` reads «В дорозі».
  Saving an order for another day jumps to that day. Open question for the user: a stored «оформлено/оплачено» status.
  Daily reminder (`DailyReminder`) to desks without an order for tomorrow. **Business rule (user, 2026-11-06): orders for the next day must be placed by 15:00; that is why the reminder fires at 14:30** (keep `REMINDER_AT` default 14:30). The cutoff itself is not enforced in code; ask before blocking late orders.
- **Notifications** (platform): `notifications` table, `platform.Notify/Recipients`, API list/read/read-all (own rows only);
  scheduler `web.RunScheduler` runs module reminders at `REMINDER_AT` (default 14:30) in `APP_TIMEZONE` (Europe/Kyiv),
  prunes old rows. Frontend bell polls every 20 s; device notifications go through the service worker (new Notification() throws on Android). **Web Push** (platform/webpush.go, web/push.go, sw.js): VAPID key in `<data>/vapid.key`, `push_subscriptions` table, dispatcher polls `pushed_at=0` every 3 s outside the write tx, stale rows (>10 min) retired unsent, allowlist of push hosts. `DeviceSetup` (first sign-in) asks notifications + install; shares a dialog slot with BiometricOffer. Real phone delivery was NOT tested in the sandbox.
- **Backups** (store): UTC names `reports-YYYYMMDD-HHMMSSZ[-tag].db`, ordered by time in name; change detection by content
  fingerprint excluding volatile tables (sessions, devices, passkeys, notifications); snapshots (downloads) capped at 10
  outside `BACKUP_KEEP`; per-copy download endpoint validates names against the list.
- **Sessions/auth**: server-side sessions (hashed token), device tokens, passkeys, login rate limit, CSRF/same-origin guard.
- **system/update**: Cloudflare tunnel supervisor, health, self-update from GitHub Releases.
- **Technical health page** (2026-11-07): hub section «Стан програми» (`/admin/manage/health`, `platform.system.manage`),
  `GET /admin/system/metrics` (build/uptime/runtime/DB/disk/backups/jobs/push/sessions/HTTP counters; integrity verdict
  cached 10 min, `POST /admin/system/integrity-check` forces it). Backup health = the job's own `last_run_at`/`last_error`
  (`store.Backups.RunStatus`), NOT the newest file's age (copies are skipped when nothing changed). Background jobs record
  runs in `web.jobs`. 4xx are refusals (never red), 5xx are program faults. `system.FreeDisk` has unix and windows files.
  Business metrics belong on the separate management dashboard, not here.
- Overdue-orders banner is dispatcher-only (`transport.orders.manage`); military orders have their own dark shield pill.
- **Management dashboard** (2026-11-07): separate slice `internal/management` + `frontend/src/modules/management` (user asked for a
  separate module with its own view permission). Permission `management.dashboard.view` (platform scope, view-only; the
  administrator gets it at runtime from the registry, so no migration). `GET /dashboard?period=` is the only gate: reports.review
  or transport.manage do NOT open it. The module has no data; other modules supply blocks through `core.Module.Dashboard`
  (shell collects via `core.Services.Dashboard`). Generic renderer in the module: tiles, CSS bars, ranked lists, every value
  also as text. Money = submitted reports only, equals the summary grand total (tested against `/admin/summary`); drafts are a
  separate tile. Transport: orders belong to a month by service date; reply time = first `accepted`/`rejected` event (a desk
  cancel is not a reply); «зараз» tiles ignore the month. Contracts changed on purpose: `modules` of the session gained
  `management`, the administrator's permissions and the catalogue gained the new code. To use: create a «Керівництво» role with
  this one permission, platform scope, user without a division.

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
  Daily reminder (`DailyReminder`) to desks without an order for tomorrow. **Business rule (user, 2026-11-06): orders for the next day must be placed by 15:00; that is why the reminder fires at 14:30** (keep `REMINDER_AT` default 14:30). The cutoff itself is not enforced in code; ask before blocking late orders.
- **Notifications** (platform): `notifications` table, `platform.Notify/Recipients`, API list/read/read-all (own rows only);
  scheduler `web.RunScheduler` runs module reminders at `REMINDER_AT` (default 14:30) in `APP_TIMEZONE` (Europe/Kyiv),
  prunes old rows. Frontend bell polls every 20 s; device notifications go through the service worker (new Notification() throws on Android). **Web Push** (platform/webpush.go, web/push.go, sw.js): VAPID key in `<data>/vapid.key`, `push_subscriptions` table, dispatcher polls `pushed_at=0` every 3 s outside the write tx, stale rows (>10 min) retired unsent, allowlist of push hosts. `DeviceSetup` (first sign-in) asks notifications + install; shares a dialog slot with BiometricOffer. Real phone delivery was NOT tested in the sandbox.
- **Backups** (store): UTC names `reports-YYYYMMDD-HHMMSSZ[-tag].db`, ordered by time in name; change detection by content
  fingerprint excluding volatile tables (sessions, devices, passkeys, notifications); snapshots (downloads) capped at 10
  outside `BACKUP_KEEP`; per-copy download endpoint validates names against the list.
- **Sessions/auth**: server-side sessions (hashed token), device tokens, passkeys, login rate limit, CSRF/same-origin guard.
- **system/update**: Cloudflare tunnel supervisor, health, self-update from GitHub Releases.

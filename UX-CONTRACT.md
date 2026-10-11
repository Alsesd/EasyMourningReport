# UX contract — Легкий звіт

## Core workflows
- **Shop report:** choose a month → enter quantities → inspect recalculated totals → save draft or submit. Submitted reports are read-only until an administrator unlocks them.
- **Admin product management:** search → create or edit a product → explicitly save changed fields → review price-change consequences → archive or restore as appropriate.
- **Admin store management:** create/edit store credentials → change password as a separate action → archive/restore without losing report history.
- **Consolidated report:** choose a month and optional submitted-only filter → inspect per-store quantities and totals → export Excel.

## Interaction states
- Primary save actions in admin edit forms stay hidden until a value changes. Creation forms have their own explicit open/cancel controls and must not be affected by edit-form dirty-state behavior.
- Every mutation uses POST and receives the existing redirect + flash feedback pattern. Keep destructive confirmations explicit about whether records are archived or permanently deleted.
- Search filters product entries by their displayed names; matching entries in their foldout sections remain discoverable.
- Report quantity edits recalculate row subtotals and the grand total immediately. Unsaved changes trigger a browser leave warning.
- Disclosure state for admin sections is persisted locally. Do not make the archive itself collapsible; only its product/store sublists may be.
- Navigation and fixed bars must respect mobile safe areas and leave enough scroll room that content and controls are never hidden behind them.

## Resilience and accessibility
- Keep forms functional without JavaScript wherever possible; JavaScript enhances visibility, feedback, and live totals.
- Use visible keyboard focus, labels associated with inputs, accessible names for icon-only controls, and polite live announcements for flash messages.
- Honor reduced-motion preferences and do not communicate success or errors using color alone.
- Preserve PWA installation and service-worker registration; no third-party runtime assets are required.
- The application must create persistent database/secret/backup files in the resolved data directory and reuse them across restarts. A compiled executable must not write persistent data to a one-file extraction directory.

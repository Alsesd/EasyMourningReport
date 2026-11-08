# EasyMourningReport — UI behavior and implementation notes

The canonical visual design contract is maintained in [`design-system.md`](design-system.md). Runtime theme tokens are canonical in `frontend/src/app/index.css`, with semantic Tailwind mappings in `frontend/tailwind.config.js`.

## Responsive product rules

### Store screen (`/report`)
- Inside the shell like every page (sidebar on wide screens, bottom navigation on phones), one narrow column: the store name and the month as the page title with previous/next, the strip of the month's days, then the selected day's state, who saved it last and how many products are filled.
- Period navigation preserves the reporting constraints; a future period is not selectable when the data contract disallows it.
- Products form one ruled list: name, price (with an amber tag for old/new/saved prices), a stepper named after the product and price, and the line sum. A product repriced during the month lists each price under its name. With «По розрахунку» enabled each line gets a second stepper.
- Inactive items with saved quantities remain in a collapsed, read-only section.
- The day's total, the unsaved-changes note and the two actions sit in a sticky bar above the phone navigation; on phones the actions take a full row.
- Submission has an accessible confirmation step that repeats the day and total. A submitted or midnight-closed day is read-only until a reviewer unlocks it.
- Offline work keeps a local draft per store and day (with the revision it was made on) and the unsaved-change guard; an amber note says changes are kept on the device.

### Admin workspace (`/admin/*`)
- Desktop: a persistent rail with the modules' pages and the account menu; pages on the paper with a serif title and ruled sections.
- Phone/tablet: a slim top bar and a bottom navigation with safe-area padding; wide tables either scroll (with the first column pinned) or become ruled rows that open on demand.
- «Звіти» has two tabs: «За день» (default) and «За місяць» (read-only), each with the store register and the products matrix, the period picker, the «Лише надіслані» switch and the Excel export; «Не надіслано вчасно» above them when a store missed days.
- Report detail locks and unlocks days (with confirmation); the month is read-only.
- «Адміністрування» is a dashboard plus a grouped submenu; every section is a page of ruled lists. Audit entries are one ruled list on every screen size; filters stay in the URL.

### Management dashboard (`/admin/dashboard`, «Показники»)
- One page per month (the period picker, refreshed every 60 s): blocks supplied by the modules, each a ruled section of tiles, CSS bars and ranked lists. Every value is also text (no chart-only information); the unit (count, money, percent, minutes) is formatted by the client.
- Technical state (version, database, backups, errors) is not here: it is the «Стан програми» section of «Адміністрування».

## Price editing rules

- Keep product rows compact until the inline price editor is opened.
- Show one editable current price and compact price-history context; do not create a second independent price-edit flow.
- Save is enabled only when the numeric value has changed. A no-op price update must not be presented as a successful change.
- Keep the existing TanStack Query mutation and invalidation behavior so search text, expanded editor and scroll position are not needlessly reset.

## Localization and formatting

All interface copy belongs in `frontend/src/modules/reports/i18n.ts` and remains Ukrainian. Monetary amounts and periods use the existing helpers and `Intl` formatting. New design copy must not bypass localization.

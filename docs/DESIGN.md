# EasyMourningReport — UI behavior and implementation notes

The canonical visual design contract is maintained in the repository-root [`DESIGN.md`](../DESIGN.md). Runtime theme tokens are canonical in `frontend/src/app/index.css`, with semantic Tailwind mappings in `frontend/tailwind.config.js`.

## Responsive product rules

### Store screen (`/report`)
- One narrow column on every screen size: a slim header (monogram, store name, workspace link when the user has one, maker mark, theme, account), the month as the page title with previous/next, the report state and how many products are filled.
- Period navigation preserves the reporting constraints; a future period is not selectable when the data contract disallows it.
- Products form one ruled list: name, price (with an amber tag for old/new/saved prices), a stepper named after the product and price, and the line sum. A product repriced during the month lists each price under its name. With «По розрахунку» enabled each line gets a second stepper.
- Inactive items with saved quantities remain in a collapsed, read-only section.
- The month total, the unsaved-changes note and the two actions sit in a fixed footer above the safe area; on phones the actions take a full row.
- Submission has an accessible confirmation step that repeats the month and total. Submitted reports are read-only until an administrator unlocks them.
- Offline work uses the per-store/per-period local draft persistence and the unsaved-change guard; an amber note says changes are kept on the device.

### Admin workspace (`/admin/*`)
- Desktop: a persistent rail with the modules' pages and the account menu; pages on the paper with a serif title and ruled sections.
- Phone/tablet: a slim top bar and a bottom navigation with safe-area padding; wide tables either scroll (with the first column pinned) or become ruled rows that open on demand.
- «Звіти» is one month page: the store register (state, positions, sum, month total) and the products matrix, with the period picker, the «Лише надіслані» switch and the Excel export. `/admin/summary` redirects to it.
- Report detail keeps the lock/unlock confirmation and returns to its month.
- «Адміністрування» is a dashboard plus a grouped submenu; every section is a page of ruled lists. Audit entries are one ruled list on every screen size; filters stay in the URL.

## Price editing rules

- Keep product rows compact until the inline price editor is opened.
- Show one editable current price and compact price-history context; do not create a second independent price-edit flow.
- Save is enabled only when the numeric value has changed. A no-op price update must not be presented as a successful change.
- Keep the existing TanStack Query mutation and invalidation behavior so search text, expanded editor and scroll position are not needlessly reset.

## Localization and formatting

All interface copy belongs in `frontend/src/modules/reports/i18n.ts` and remains Ukrainian. Monetary amounts and periods use the existing helpers and `Intl` formatting. New design copy must not bypass localization.

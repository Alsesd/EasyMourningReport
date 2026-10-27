# EasyMourningReport — UI behavior and implementation notes

The canonical visual design contract is maintained in the repository-root [`DESIGN.md`](../DESIGN.md). Runtime theme tokens are canonical in `frontend/src/app/index.css`, with semantic Tailwind mappings in `frontend/tailwind.config.js`.

## Responsive product rules

### Store screen (`/report`)
- Phone-first report entry with a sticky translucent header, store identity, theme selector and sign-out action. Its paper workspace uses the shared low-opacity jade/brass/mineral-blue gradient atmosphere; the product rows and price table remain opaque enough for scanning.
- Period navigation must preserve the existing reporting constraints; a future period is not selectable when the data contract disallows it.
- Product rows expose clear quantity controls, price and line totals. Products repriced during a month show the available price tiers and effective dates.
- Inactive items remain available in a collapsed, read-only section where saved quantities exist.
- The sticky total/action area stays above the device safe area and does not cover keyboard-focused controls.
- Submission has an accessible confirmation step. Submitted reports are read-only until an administrator changes the report state.
- Offline work uses the existing per-store/per-period local draft persistence and unsaved-change guard.

### Admin workspace (`/admin/*`)
- Desktop: persistent deep-pine navigation rail, translucent sticky route context bar and a fluid paper-colored workspace with slow, low-opacity jade/brass/mineral-blue ambient gradients.
- Cards use restrained mineral-glass surfaces and a soft light-catching edge. Dense tables, inputs, dropdowns and dialogs stay more opaque to protect readability.
- Phone/tablet: compact top bar, four-destination bottom navigation with safe-area padding, and stacked layouts where independent records read better than tables. The bottom bar uses translucent material and blur without covering focused content.
- Summary keeps the period selector, submitted-only filter, Excel export, key metrics and matrix/card view options.
- Report lists preserve period context and show submission status, quantities and total. Detail routes preserve the lock/unlock confirmation flow.
- Settings retain the existing product, store, security, tunnel and backup workflows. Audit logs retain filter controls and formatted timestamps.

## Price editing rules

- Keep product cards compact until the inline price editor is opened.
- Show one editable current price and compact price-history context; do not create a second independent price-edit flow.
- Save is enabled only when the numeric value has changed. A no-op price update must not be presented as a successful change.
- Keep the existing TanStack Query mutation and invalidation behavior so search text, expanded editor and scroll position are not needlessly reset.

## Localization and formatting

All interface copy belongs in `frontend/src/modules/reports/i18n.ts` and remains Ukrainian. Monetary amounts and periods use the existing helpers and `Intl` formatting. New design copy must not bypass localization.

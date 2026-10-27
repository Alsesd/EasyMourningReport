# EasyMourningReport — UI Design & Architecture Notes

## 1. Visual Direction

A quiet, practical, and highly legible reporting tool: paper-like surfaces, evergreen accents, clear numeric figures, and restrained separators. The interface is engineered to feel calm and utilitarian rather than promotional, optimized for store clerks entering daily quantities on phones and administrators managing operations on desktop and mobile.

## 2. Design Tokens & Theme Source

The canonical theme source is implemented in `src/frontend/tailwind.config.js` and `src/frontend/src/app/index.css` via CSS variables and semantic Tailwind classes:

| Role | Semantic Class | Light Value | Dark Value |
|---|---|---|---|
| Page Background | `bg-page` | `#F4F6F5` | `#141B19` |
| Surface | `bg-surface` | `#FFFFFF` | `#1D2724` |
| Main Text | `text-text-main` | `#1C2A26` | `#E7EFEB` |
| Muted Text | `text-text-muted` | `#5E6E69` | `#9BAEA6` |
| Border | `border-border` | `#DCE5E1` | `#34433D` |
| Primary Action | `bg-primary`, `text-primary-foreground` | `#2E6D60` (text `#FFFFFF`) | `#8ABFB0` (text `#141B19`) |
| Destructive Action | `bg-destructive`, `text-destructive-foreground` | `#A34D4A` (text `#FFFFFF`) | `#E49A92` (text `#141B19`) |
| Pill: Sent | Status pill variant `sent` | `#DCEFE9` (text `#1F4F44`) | `#1F4F44`/30 (text `#8ABFB0`) |
| Pill: Draft | Status pill variant `draft` | `#FFF1D6` (text `#6B4A00`) | `#6B4A00`/30 (text `#F5D485`) |
| Pill: Not Started | Status pill variant `empty` | `#E9EEEC` (text `#44524E`) | `#34433D`/40 (text `#9BAEA6`) |

Theme switching supports `light`, `dark`, and `system` modes, persisted in `localStorage` under key `easyMourningReport.theme`.

## 3. Typography & Sizing

- **Font**: **Onest** (weights 400, 500, 600, 700), Cyrillic + Latin, self-hosted through `@fontsource/onest`. Zero external runtime font or CDN dependencies.
- **Radii**: Cards 16 px (`rounded-2xl`), controls and buttons 12 px (`rounded-xl`), status pills fully round (`rounded-full`).
- **Touch Targets**: Minimum 44 px on all interactive controls (buttons, quantity steppers, inputs, bottom navigation tabs).
- **Focus Rings**: High-contrast, visible keyboard focus indicators (`focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none`).
- **Accessibility & Motion**: Adheres to WCAG AA contrast standards throughout light and dark modes. Respects `prefers-reduced-motion: reduce` by dampening or disabling transitions.

## 4. Component Rules & Layout

### Store Screen (`/report`)
- **Mobile-first Layout**: Centered `max-w-md` container on desktop screens; full-width responsive view on phones.
- **Header**: Sticky opaque header with store name, theme picker, and logout action.
- **Month Selector**: Previous / next month switcher with current status pill. Next month navigation is disabled past the current reporting month.
- **Product Cards**: Clear product name, price tag, 44 px stepper (`−` / numeric input / `+`), and calculated line total.
- **Repriced Products**: Products repriced within the active month render one row per price tier, annotated with the effective start date.
- **Inactive Items**: Collapsed in a collapsible section at the bottom of the list, shown in read-only mode.
- **Sticky Summary Footer**: Displays month total amount, secondary "Зберегти чернетку" action, and primary "Надіслати звіт" action.
- **Submission Guard**: Accessible modal confirmation dialog prior to final submission. Submitted reports become read-only.
- **Offline & Persistence**: In-progress edits are persisted in `localStorage` per store and period (`easyMourningReport.drafts.${storeId}.${period}`) with an offline/pending sync indicator. A `beforeunload` handler guards against accidental loss of uncommitted edits.

### Admin Workspace (`/admin/*`)
- **Responsive Shell**:
  - Desktop (≥768 px): Fixed 240 px left sidebar containing navigation links, brand mark, and sign-out button.
  - Mobile (<768 px): Sticky bottom navigation tab bar with 44 px touch targets for all primary admin views.
  - Top Bar: Opaque sticky header displaying the active view title and administrator session details.
- **Зведений (Summary - `/admin/summary`)**:
  - Period switcher with submitted-only filter toggle.
  - Direct server link to export `.xlsx` report (`/admin/summary.xlsx?period=...`).
  - Key Performance Indicator (KPI) cards: Total revenue, submitted stores count, reported goods count.
  - Horizontally scrollable data matrix table with status pills and sticky header.
- **Звіти (Reports - `/admin/reports`)**:
  - Period filter, responsive store cards showing submission status pill, grand sum, number of reported items, and direct navigation to report detail.
- **Деталі звіту (Report Detail - `/admin/reports/:storeId`)**:
  - Breadcrumb navigation back to reports list.
  - Store title header with lock/unlock status switch protected by a confirmation dialog.
  - Detailed product table with price, quantity, and row sum. Collapsible inactive section.
- **Налаштування (Settings - `/admin/settings`)**:
  - 5 accessible Radix UI tabs:
    1. *Товари (Products)*: Live search filter, single-input price editing with historical price chips, Excel (.xlsx) bulk import, archive and restore actions.
    2. *Магазини (Stores)*: Store list with active report indicators, store creation form, inline edit for store name and login, password reset modal, archive and restore.
    3. *Безпека (Security)*: Administrator password change form with validation.
    4. *Тунель (Tunnel)*: Cloudflare Tunnel status card with Quick Tunnel URL, autostart toggle, and manual start/stop actions.
    5. *Резервна копія (Backup)*: Direct download attachment link to the server database snapshot (`/admin/backup/download`).
- **Журнал (Audit Logs - `/admin/logs`)**:
  - Filterable by audit action dropdown (dynamically populated from `/api/v1/admin/log-actions`).
  - Username search filter.
  - Formatted timestamps (`Intl.DateTimeFormat('uk-UA')`) and action description badges.

## 5. Price Editing Rules

- Product cards remain compact until the price editing foldout is expanded.
- Each product has exactly one price input field.
- Expanding the editor reveals the input and at most two compact history chips: the price before this month's change and the current active price.
- Saving is enabled only when the input value has changed numerically (`1.0` and `1.00` are treated as equal).
- Optimistic mutations via TanStack Query invalidate and refresh the server state while preserving search query, foldout state, and scroll position.

## 6. Formatting & Localization

- All UI strings are kept exclusively in Ukrainian in `src/frontend/src/shared/i18n/uk.ts`.
- Money and numeric calculations formatted via `Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` (converting server integer `price_cents` to formatted UAH).
- Dates and timestamps formatted via `Intl.DateTimeFormat('uk-UA', ...)`.

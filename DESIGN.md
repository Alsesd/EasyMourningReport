---
version: alpha
name: EasyMourningReport
description: "A calm internal reporting workspace for a burial-service business, designed around reliable records rather than funeral imagery."
colors:
  primary: "#285448"
  background: "#F3F2EB"
  surface: "#FFFEFA"
  text: "#20332D"
  muted: "#5F6D64"
  border: "#D7DED4"
  accent: "#80643A"
  accent-cool: "#3C8276"
  accent-cool-soft: "#E0EFEA"
  danger: "#9C4B43"
typography:
  sans:
    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.9375rem"
spacing:
  section-gap: "1.5rem"
  page-max: "96.25rem"
components:
  button:
    minHeight: "44px"
    radius: "0.625rem"
  card:
    radius: "0.9375rem"
    border: "1px solid var(--border)"
  navigation:
    desktopSidebarWidth: "258px"
    mobileBottomBar: "enabled"
---

# EasyMourningReport Design System

## Overview

### Creative North Star

A well-kept records room: dark pine cabinetry, archival paper, a discreet brass index tab, precise ledgers and clear figures. The app should feel dependable and humane, with no literal funeral imagery, mourning clichés, heavy black surfaces or decorative gravestone motifs. Its distinctive move is the pairing of a deep evergreen navigation rail, warm paper-like working surfaces, mineral-glass translucency, an oxidized-jade counterpoint and one muted brass accent.

### Product context and register

- **Audience and primary job:** Internal staff and administrators of a burial agency enter monthly store quantities, review submissions, manage the catalogue and accounts, and download reports.
- **Target market(s) and evidence:** Ukrainian interface and Ukrainian numeric/date formatting are established in `frontend/src/modules/reports/i18n.ts`; the app brief identifies the business as a burial agency.
- **Locale(s) and language policy:** Ukrainian (`uk-UA`) for interface copy, dates and currency. New user-facing labels belong in the shared `uk` dictionary.
- **Usage scene:** Repeated operational use on desktop at an office, with store/report entry also used on phones. Controls need touch-safe sizing and content must work without hover.
- **Register:** Product/admin; consistency, task clarity, data density and recovery take priority over expressive presentation.
- **Memorable signature:** A deep-pine navigation rail, mineral-glass panels over an atmospheric jade/smoke background, and a restrained brass line/marker. The glass should catch light at edges but remain readable and operational.
- **Restraint:** Data tables, forms, destructive actions, status and error states remain plain and unambiguous.
- **Anti-references:** Generic blue SaaS dashboards, black-and-white funeral tropes, oversized marketing hero metrics, overly transparent glass that compromises legibility, rainbow/neon gradients, and animation on every interaction.
- **Token ownership/runtime mapping:** Existing runtime CSS custom properties remain canonical in `frontend/src/app/index.css`. Tailwind semantic colors in `frontend/tailwind.config.js` consume the variables; shared UI components use those semantic classes. This file mirrors those values and records intent. When tokens change, update this file, runtime CSS, Tailwind adapters if applicable, and `docs/DESIGN.md` in the same change.

## Colors

Light mode uses a warm mineral-paper background (`#F3F2EB`), an almost-white work surface (`#FFFEFA`), deep green primary (`#285448`), ink-green text (`#20332D`) and soft sage-grey borders (`#D7DED4`). Muted brass (`#80643A`) is an expressive accent for section eyebrows and small detail. Oxidized jade (`#3C8276`) provides a cooler counterpoint for atmospheric light, active navigation and subtle glass tints; it is not a new status color. Dusty mineral blue may appear only in low-opacity background glows, never as a primary action color. Destructive actions use brick red and must be paired with explicit wording. Submitted, draft and empty statuses retain distinct semantic tints.

Dark mode uses ink-pine (`#111C18`) and lifted green surfaces (`#192720`, `#22352B`), with light text and softer evergreen actions. The jade token adapts to `#8CCBBC`; translucent surfaces retain 89–94% base-surface coverage to preserve text clarity while allowing gradients to show through. Contrast must remain sufficient for labels, badges and focus. The green primary and brass accent must never be the only indicators of status.

## Typography

Onest is self-hosted from `@fontsource/onest`; no external font network dependency is introduced. Use semibold for route headings, labels and values, regular text for supporting content, and tabular numerals for money, totals and periods. Avoid long all-caps labels; uppercase tracking is reserved for short utility eyebrows. System monospace is acceptable for technical identifiers, never required for routine prose.

## Layout

The desktop admin shell uses a 258px pine rail and a paper work area with a sticky top bar. Main content is fluid up to 1540px, with gutters that scale with viewport width. At tablet/mobile widths the rail disappears, the top bar becomes compact, and four primary admin destinations move to a fixed bottom bar with safe-area padding. Bottom navigation must not cover focused fields or primary actions; page content keeps bottom breathing room.

Store entry remains narrow and readable on mobile; desktop tables preserve their comparison relationships and expose overflow instead of silently losing columns. Cards may stack when each record is independently understandable. Inputs and controls should remain at least 44px tall where users tap them. Preserve natural vertical scrolling for long settings/forms.

## Elevation & Depth

Hierarchy comes from background tone, layered mineral gradients, glassy edge highlights and measured shadows—not large floating cards. Sticky headers and primary cards use restrained translucency with an 18–24px blur; dense tables, inputs, dropdowns and dialogs remain more opaque for legibility. A slow aurora-like background drifts behind the admin workspace and stops under `prefers-reduced-motion`. The sign-in identity panel is the broadest atmospheric surface on desktop; it shows the app name without promotional copy. Below the desktop breakpoint it collapses to a compact brand strip so the login fields stay near the top and fit small phone screens. Dark mode reduces shadow contrast and relies more on borders and jade light.

## Shapes

Cards use approximately 15px radii, controls approximately 10px, and small icon containers around 10–12px. Pills are reserved for status or session indicators. The desktop active navigation item has a brass left rule and tinted fill; inactive items remain plain. Dividers are hairlines. Do not use excessive nested cards or pill-shaped everything.

## Components

### Foundational visual states

Hover is subtle; focus-visible uses a high-contrast primary ring; active controls provide clear pressed feedback; disabled controls remain visibly disabled; busy states preserve control geometry and show progress. Error and success messages are explicit and announced through the existing role/live-region markup. Loading states use the existing app-owned spinner rather than a decorative full-screen animation.

### Buttons and actions

Primary buttons use evergreen, secondary actions use a surface with a border, and destructive actions use brick red. Icon-only controls require a localized accessible name. Primary actions should be visually easy to locate without making every control high-emphasis.

### Navigation and data display

Desktop navigation is persistent; mobile navigation is fixed at the bottom and respects safe-area insets. Current destinations use `aria-current="page"`. Tables retain their labels and comparison semantics; data is formatted through the Ukrainian helpers in `i18n.ts`. Status pills always include readable text.

### Forms and overlays

Labels remain visible and inputs use the shared UI components. Authentication is task-first: show the app name, the login heading and the credential fields without an introductory pitch, security paragraph or redundant card heading. On phone-sized layouts, keep the brand strip compact and place the fields immediately below the small utility row; avoid requiring vertical scroll to reach the username and password. Authentication supports autocomplete and password managers. Product and store operations keep the existing confirmation dialogs and pending states. Do not replace recoverable errors or destructive confirmations with browser-native `alert` / `confirm` dialogs.

### Iconography

Use Lucide React, primarily 16–20px outline icons with consistent optical weight. Icons supplement, not replace, labels except for genuinely familiar controls with accessible names.

### Motion

Motion is brief and functional: around 140–220ms for simple interaction feedback, with route/page transitions kept understated. A single very slow ambient gradient drift (24 seconds) is permitted behind the admin workspace only, not on data elements, and is disabled for `prefers-reduced-motion`. Avoid parallax, shimmer sweeps, pulsing data and motion on every interaction.

### Content and data visualization

Use direct Ukrainian wording, sentence case and consistent action verbs. Format currency, numbers and dates with the shared `Intl` helpers. Avoid euphemistic or emotional copy in operational tasks; the domain calls for calm precision and discretion.

## Do's and Don'ts

- **Do:** Use warm surfaces, evergreen navigation, oxidized-jade atmosphere and muted brass in a stable hierarchy.
- **Do:** Let glass catch background light at the panel edge, with enough opacity that the text layer remains calm.
- **Do:** Keep reporting periods, sums, submission status and account actions easy to scan on both desktop and mobile.
- **Don't:** Introduce literal funeral imagery, pitch-like marketing language, gradients inside every table cell, high-transparency panels behind dense text or blue/purple SaaS styling.
- **Don't:** Hide necessary actions behind hover, reduce focus visibility, or let mobile navigation cover content.

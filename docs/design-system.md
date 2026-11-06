---
version: beta
name: EasyMourningReport
description: "«Книга обліку»: an internal record book for a burial-service business. Paper, graphite ink and ruled sections; calm precision instead of funeral imagery."
colors:
  page: "#FCFCFA"
  surface: "#FFFFFF"
  surface-raised: "#F1F4F2"
  text: "#1D2A2B"
  muted: "#5B6867"
  border: "#D7DDD9"
  ink-rule: "#1D2A2B"
  primary: "#22504A"
  primary-soft: "#E4EEEB"
  attention: "#9A5C12"
  attention-soft: "#F6ECDD"
  destructive: "#9C3B33"
typography:
  interface:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
  book:
    fontFamily: "Literata, Georgia, serif"
rounded:
  card: "6px"
  control: "4px"
components:
  button:
    minHeight: "44px"
    radius: "4px"
  section:
    topRule: "2px solid var(--ink-rule)"
  total:
    rule: "4px double var(--ink-rule)"
  navigation:
    desktopRailWidth: "240px"
    mobileBottomBar: "enabled"
---

# EasyMourningReport design: «Книга обліку»

## Idea

The app is a record book. Each page is a sheet of paper with ruled sections: a serif heading, a heavy ink rule, then rows divided by hairlines. Totals sit under an accountant's double rule. Figures (money, quantities, months) are set in a book serif with aligned digits, because figures are what people come here to read. Interface text is a plain, sturdy sans.

The domain asks for calm precision and discretion: no funeral imagery, no black-and-white mourning tropes, no glass, gradients or floating cards.

- **Audience and job:** store staff enter monthly quantities, mostly on phones; administrators review the month, export Excel, and manage the catalogue, accounts and system, mostly on desktops.
- **Language:** Ukrainian (`uk-UA`) for all copy, dates and money. Strings live in `frontend/src/platform/i18n.ts` and each module's `i18n.ts`.
- **Token ownership:** CSS custom properties in `frontend/src/app/index.css` are canonical (light and dark). `frontend/tailwind.config.js` maps them to Tailwind colours through `token()`, so opacity modifiers work. Change all three places, and this file, together.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `page` | `#FCFCFA` | `#121918` | The paper. Every page background. |
| `surface` | `#FFFFFF` | `#182120` | Inputs, menus, dialogs, raised sheets such as a "new item" form. |
| `surface-raised` | `#F1F4F2` | `#1D2827` | The desktop rail, hover fills, inline edit panels. |
| `text` / `muted` | `#1D2A2B` / `#5B6867` | `#E6EBE9` / `#9AA7A5` | Graphite ink and its quieter tone. |
| `border` | `#D7DDD9` | `#2D3A39` | Hairline rules between rows. |
| `ink-rule` | `#1D2A2B` | `#C9D3D0` | Heavy rules: section tops, totals. |
| `primary` | `#22504A` | `#8CC4B3` | Spruce: the brand, primary actions, "sent", the current place. |
| `attention` | `#9A5C12` | `#E0A85C` | Beeswax amber: only for what needs attention (no report yet, unsaved changes, offline, price tags). |
| `destructive` | `#9C3B33` | `#E99A90` | Delete and errors, always with explicit words. |

Colour is never the only signal: statuses carry a word and a mark, errors carry text.

## Type

- **IBM Plex Sans** 400/500/600 for the interface, 15px body. Labels are sentence case, never tracked capitals.
- **Literata** 400/600 for headings (h1 to h3) and every figure. The `.figure` class (and `font-mono`, kept for existing markup) sets Literata with tabular lining numerals so columns of money line up.
- Page titles are large serif names of the thing on the page: the month («Листопад 2026»), the store, the section. A small crumb above says where the page sits.
- Both fonts are self-hosted through `@fontsource`; there is no external font request.
- Money reads the Ukrainian way through `formatCurrency`: `3 726,50 ₴` (no-break spaces). Inputs keep `formatMoney` (`3726.50`), which a person can type back.

## Layout

- **Desktop shell:** a 240px rail on `surface-raised`: the «ЛЗ» monogram and name, the modules' pages (the current one has a spruce inset bar), and at its foot the account menu, theme and maker mark. Content sits on the paper with generous gutters.
- **Phones:** a slim top bar (monogram, maker mark, theme, account) and a bottom bar with the modules' pages; the current one has a spruce top rule.
- **Pages:** `ui/PageHeader` (crumb, serif title, one line of context, actions), then `ui/LedgerSection`s. Content stays left-aligned.
- **Store report (`/report`):** a narrow single column on every screen size: month title with previous/next, then one ruled list of products (name, price, stepper, line sum). A product with several prices in the month lists each price under its name. The month total and the two actions stay in a footer above a heavy rule.
- **«Звіти» month page (`/admin/reports`):** the store register (each store's state and sum, a double-ruled month total; a store without a report gets an amber row) and the products matrix that the Excel file mirrors. On phones the matrix becomes one ruled row per product whose store breakdown opens on demand. `/admin/summary` redirects here.
- **«Адміністрування» (`/admin/manage`):** a dashboard of figures, system state and recent activity, with the grouped submenu beside it (a scrolling tab row on phones). Each module adds its own sections to the submenu.

## Shape and depth

Paper does not float: panels have no shadow and sit flat. Structure comes from rules: a 2px ink rule tops each section, hairlines divide rows, a 4px double rule closes a total. Only overlays (menus, dialogs) cast a shadow. Radii are small: 6px for sheets, 4px for controls; round shapes are kept for status marks, the switch and avatars.

## Components

- **Buttons:** primary is solid spruce; outline is paper with a hairline; ghost has no border; destructive is brick. No press-scaling. `buttonClass()` gives links (downloads) the same look.
- **Status words:** `StatusPill` is a word with a small mark, not a pill: spruce dot «Надіслано», hollow mark «Чернетка», amber dot «Немає звіту».
- **Notices:** a coloured left edge on a soft fill, with text, announced to screen readers.
- **Inline editing:** the edit panel opens under its row with a spruce left edge.
- **Archived items:** a collapsed `<details>` at the end of the list.
- **Steppers** are named after what they count («Кількість: Свічка поминальна, 25,00 ₴»).
- **Maker mark:** the italic serif «A.» that reveals «made by Alsesd». It stays on every screen (rail or top bar, store report, login).

## Motion

Short fades only where something appears in answer to a person (menus, dialogs, collapsible panels). No ambient motion, no entrance animations, no hover lifts. Everything respects `prefers-reduced-motion`.

## Do and don't

- **Do** let the figures carry the page: the month, the sums, the counts.
- **Do** keep every action labelled in plain Ukrainian with the same verb through the flow («Надіслати звіт» → «Звіт надіслано»).
- **Don't** add cards with shadows, gradients, glass, tracked capitals, middle-dot meta strings, or arrows appended to labels.
- **Don't** use amber for decoration; it means "look at this".

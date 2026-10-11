# Design system — Легкий звіт

## Product and audience
A Ukrainian-language, mobile-first reporting tool for shop staff and the administrator. Its job is to make monthly quantity entry, price changes, and consolidated reporting feel dependable and quick—not like an accounting spreadsheet squeezed into a phone.

## Visual direction: the calm ledger
Use the visual language of a well-made paper ledger translated into a modern app: quiet surfaces, strong typographic hierarchy, generous touch targets, and a distinctive deep botanical green that signals saved/financially meaningful actions. Avoid ornamental gradients, stock illustrations, and excessive motion.

### Tokens
| Token | Light | Dark | Purpose |
|---|---|---|---|
| Background | `#F4F7F5` | `#101714` | App canvas |
| Surface | `#FFFFFF` | `#171F1B` | Cards and forms |
| Raised surface | `#FFFFFF` | `#1C2621` | Disclosure headers and active form areas |
| Ink | `#18231F` | `#EDF4EF` | Main text |
| Muted | `#64736C` | `#A2B2A8` | Labels and supporting text |
| Line | `#DCE5DF` | `#2B3A31` | Boundaries and dividers |
| Accent | `#176B55` | `#8DD6B4` | Primary actions, links, totals |
| Accent soft | `#E5F3EC` | `#20382D` | Selected states and status surfaces |
| Danger | `#B42332` | `#FF9DA5` | Destructive actions and errors |

Runtime ownership: `app/static/app.css` is the source of truth for CSS variables and component styling. Templates consume classes; do not re-declare palette values inline unless required for user-generated data.

## Typography
- Display / page titles: system UI serif stack (Georgia fallback) for a restrained editorial identity.
- Body / controls / data: system UI sans-serif for legibility and native-platform familiarity.
- Amounts and quantities use tabular numerals to keep columns visually stable.
- Labels are compact and semibold; headings use sentence case except small uppercase section labels.

## Layout and components
- Main content is capped at 820px on desktop and fluid on mobile.
- Cards and disclosure sections use a consistent 18px radius; fields and secondary controls use 11–13px.
- Touch targets are at least 44px high.
- Persistent admin tabs and report action bars respect device safe areas and use a translucent surface only to preserve context behind them.
- Tables may scroll horizontally; their first column remains sticky for row context.
- No external fonts or icon services: the UI remains fast and usable offline.

## Motion and accessibility
- Motion is limited to subtle action transitions and a short flash-message entrance.
- `prefers-reduced-motion: reduce` removes nonessential animation and smooth scrolling.
- Every interactive element has a visible focus ring; forms and navigation retain native semantics.
- The base layout includes a keyboard skip link, named admin navigation, and polite live feedback.

## Change discipline
When changing the visual system, update this document and `app/static/app.css` together. Prefer existing semantic classes over one-off styling. Preserve the Ukrainian language, current workflow behavior, PWA/offline assets, and the report's sticky total/action bar.

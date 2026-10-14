# EasyMourningReport — UI design notes

## Visual direction

A quiet, practical reporting tool: paper-like surfaces, evergreen accents, clear price figures, and restrained separators. The interface should feel calm and readable rather than promotional.

## Runtime token owner

`app/static/app.css` is the canonical runtime theme source. Browser theme metadata in `app/templates/base.html` mirrors the page background.

| Role | Light | Dark |
|---|---|---|
| Page background | `#F4F6F5` | `#141B19` |
| Surface | `#FFFFFF` | `#1D2724` |
| Main text | `#1C2A26` | `#E7EFEB` |
| Muted text | `#687873` | `#9BAEA6` |
| Border | `#DCE5E1` | `#34433D` |
| Primary action | `#2E6D60` | `#8ABFB0` |
| Destructive action | `#A34D4A` | `#E49A92` |

## Price editing

- Product cards stay compact until the price control is expanded.
- Each product has one price input. Expanding it reveals the input and at most two compact history chips: the price before this month's change and the current price.
- A price change keeps the prior and new prices available to reports for the current month, but only one current-month price record is retained for future months.
- Save appears only for changed values. Existing prices compare numerically, so `1.0` and `1.00` are equivalent.
- A successful save replaces just that product card from the server response, closes the editor, and preserves the rest of the page, search query, foldout state and scroll position.
- Errors remain beside the edited card; the editor stays available for correction.

## Asset and interaction boundaries

- `app/templates/base.html` and `admin.html` contain semantic structure only.
- Global behavior is in `app/static/app.js`; admin-only behavior is in `app/static/admin.js`; styles remain in `app/static/app.css`.
- Keep visible input labels, keyboard focus rings, touch-sized controls and a responsive single-column price editor.
- The single price input uses the full available width; history is presented as compact chips, not editable price variants.
- Bottom tabs use ordinary page navigation rather than replacing the main DOM in place, avoiding stale or missing page-specific event handlers after tab switches.
- The app mark and account header form one opaque, layered sticky surface so scrolling content never shows through the header.
- Theme choice remains available through a small display-preferences menu; fullscreen is not a header action.
- Use the server's confirmed response as the source of truth. Reduced-motion preferences shorten or remove transitions.

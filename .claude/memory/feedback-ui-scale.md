---
name: feedback-ui-scale
description: users need an adjustable interface size (one finds it too big, older staff too small); fonts must be rem
type: feedback
---

The user found the default interface too large, while older staff in other divisions may find it too small. There is a
per-device scale (80–160 %) in the theme menu «Вигляд» (`platform/theme/uiScale.ts`, root font size, localStorage).
**Why:** different people on different devices; one fixed size does not fit.
**How to apply:** write font sizes in rem (`text-[0.9375rem]`), never `text-[Npx]`, or they ignore the scale. Touch-target
floors stay `min-h-[44px]`. Avoid CSS `zoom` (dialogs with vh and popover positioning break).

/**
 * The action bar of a long form in a dialog: on a phone it sticks to the bottom of the sheet and also covers the sheet's
 * bottom padding (so nothing scrolls by underneath it); from `sm` up it is an ordinary row.
 * The offsets mirror the phone sheet's bottom padding in app/index.css (`.dialog-panel`: 1.25rem + safe area).
 */
export const stickyActions =
  "sticky bottom-[calc(-1.25rem-env(safe-area-inset-bottom))] z-10 -mx-4 -mb-[calc(1.25rem+env(safe-area-inset-bottom))] border-t border-border bg-surface px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0";

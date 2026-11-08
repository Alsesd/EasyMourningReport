import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/ui/utils";

/** A match with the parts of its label to light up (indexes into the label as written). */
export interface ComboboxHit<T> {
  item: T;
  ranges?: [number, number][];
}

export interface ComboboxLabels {
  /** Shown when nothing matches. */
  empty: string;
  /** Read out after typing: how many suggestions there are. */
  count: (n: number) => string;
  clear: string;
  open: string;
}

const defaultLabels: ComboboxLabels = {
  empty: "Нічого не знайдено",
  count: (n) => `Варіантів: ${n}`,
  clear: "Очистити",
  open: "Показати варіанти",
};

/** Label text with the matched parts marked. */
export function Highlighted({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={i} className="rounded-sm bg-primary-soft px-0 font-semibold text-text-main">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Searchable select (ARIA combobox with a listbox popup): type to filter, ↑↓ to move, Enter to choose, Esc to close.
 * Rows are 44 px. Filtering is the caller's `search` (to rank and highlight in its own way); without one the label
 * is searched as a substring. Not a native datalist: that one renders in the browser's language.
 */
export function Combobox<T>({
  id,
  label,
  hideLabel,
  items,
  value,
  onChange,
  getKey,
  getLabel,
  renderMeta,
  search,
  placeholder,
  disabled,
  clearable,
  limit = 50,
  labels,
  invalid,
  required,
  className,
}: {
  id?: string;
  /** Names the field for screen readers (and is shown above it unless `hideLabel`). */
  label: string;
  hideLabel?: boolean;
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  getKey: (item: T) => string | number;
  getLabel: (item: T) => string;
  /** Secondary text of a row, shown muted after the label. */
  renderMeta?: (item: T) => React.ReactNode;
  search?: (query: string) => ComboboxHit<T>[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  limit?: number;
  labels?: Partial<ComboboxLabels>;
  invalid?: boolean;
  /** Marks the field as required (asterisk and aria-required). */
  required?: boolean;
  className?: string;
}) {
  const l = { ...defaultLabels, ...labels };
  const auto = useId();
  const inputId = id ?? `${auto}-input`;
  const listId = `${auto}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hits = useMemo<ComboboxHit<T>[]>(() => {
    const q = typing ? query.trim() : "";
    if (search) return search(q).slice(0, limit);
    if (!q) return items.slice(0, limit).map((item) => ({ item }));
    const lower = q.toLowerCase();
    const out: ComboboxHit<T>[] = [];
    for (const item of items) {
      const at = getLabel(item).toLowerCase().indexOf(lower);
      if (at >= 0) out.push({ item, ranges: [[at, at + lower.length]] });
      if (out.length >= limit) break;
    }
    return out;
  }, [items, query, typing, search, limit, getLabel]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setTyping(false);
    setQuery("");
  };
  const choose = (item: T) => {
    onChange(item);
    close();
  };
  const shown = typing ? query : value ? getLabel(value) : "";
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={inputId} className={cn("mb-1.5 block text-sm font-medium text-text-main", hideLabel && "sr-only")}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits.length > 0 ? optionId(active) : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-required={required ? true : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={shown}
          onChange={(e) => {
            setQuery(e.target.value);
            setTyping(true);
            setOpen(true);
          }}
          onFocus={(e) => {
            setOpen(true);
            e.currentTarget.select();
          }}
          onBlur={close}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) setOpen(true);
              else setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (open && hits[active]) {
                e.preventDefault();
                choose(hits[active].item);
              }
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation(); // do not close a dialog around the field
              close();
            }
          }}
          className={cn(
            "flex min-h-[44px] w-full rounded-control border border-border bg-surface py-2 pl-3 pr-16 text-[0.9375rem] text-text-main placeholder:text-text-muted/70 transition-colors duration-150 hover:border-text-muted/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
          )}
        />
        <div className="absolute inset-y-0 right-0 flex items-center">
          {clearable && value && !disabled && (
            <button
              type="button"
              aria-label={l.clear}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(null);
                close();
              }}
              className="flex h-11 w-9 items-center justify-center text-text-muted hover:text-text-main"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label={l.open}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? close() : (inputRef.current?.focus(), setOpen(true)))}
            className="flex h-11 w-9 items-center justify-center text-text-muted hover:text-text-main"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {open && typing ? (hits.length === 0 ? l.empty : l.count(hits.length)) : ""}
      </p>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-border bg-surface py-1 shadow-overlay"
      >
        {hits.length === 0 && (
          <li role="presentation" className="flex min-h-[44px] items-center px-3 text-sm text-text-muted">
            {l.empty}
          </li>
        )}
        {hits.map((h, i) => {
          const selected = value !== null && getKey(value) === getKey(h.item);
          return (
            <li
              key={getKey(h.item)}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(h.item)}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[0.9375rem] text-text-main",
                i === active && "bg-surface-raised",
                selected && "font-semibold",
              )}
            >
              <span className="min-w-0 break-words">
                <Highlighted text={getLabel(h.item)} ranges={h.ranges} />
              </span>
              {renderMeta && <span className="shrink-0 text-sm text-text-muted">{renderMeta(h.item)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

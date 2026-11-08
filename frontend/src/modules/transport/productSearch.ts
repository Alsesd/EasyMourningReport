/**
 * Product search for the request form (docs/plans/product-orders.md §5), done in the browser on the cached catalogue.
 * Every query word must start some word of the name (anywhere in it); numbers match exactly; units are unified
 * («3 метра» = «3м»); look-alike Ukrainian/Russian letters are one letter. When nothing matches, a substring search
 * follows, then the query is read as if typed on the English keyboard layout.
 * The §5 ordering rule "how often this desk orders it" has no data in v2 and is skipped.
 */

export type Range = [start: number, end: number];

export interface SearchHit<T> {
  item: T;
  /** Parts of the name to highlight (indexes into the name as written). */
  ranges: Range[];
}

interface Token {
  start: number;
  end: number;
  norm: string;
  numeric: boolean;
}

interface Entry<T> {
  item: T;
  name: string;
  tokens: Token[];
}

const FOLD: Record<string, string> = { і: "и", ї: "и", є: "е", ґ: "г", ё: "е", ы: "и", э: "е" };
const UNITS = new Set(["метр", "метра", "метри", "метру", "метром", "метрами", "метрив"]);
const CM = new Set(["сантиметр", "сантиметра", "сантиметри", "сантиметрив", "сантиметрами"]);

function foldWord(word: string): string {
  const folded = Array.from(word).map((ch) => FOLD[ch] ?? ch).join("");
  if (UNITS.has(folded)) return "м";
  if (CM.has(folded)) return "см";
  return folded;
}

/** Words of a text with their places: letters and digits are separate words ("3м" -> "3", "м"); apostrophes are dropped. */
function tokenize(text: string): Token[] {
  const lower = text.toLowerCase();
  const tokens: Token[] = [];
  const re = /\d+|[\p{L}'’ʼ`]+/gu;
  for (const m of lower.matchAll(re)) {
    const raw = m[0];
    const letters = raw.replace(/['’ʼ`]/g, "");
    if (!letters) continue;
    const numeric = /^\d/.test(letters);
    tokens.push({ start: m.index ?? 0, end: (m.index ?? 0) + raw.length, norm: numeric ? letters : foldWord(letters), numeric });
  }
  return tokens;
}

/** Cyrillic letters on the keys of the standard Ukrainian layout, by the English key. */
const LAYOUT: Record<string, string> = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з", "[": "х", "]": "ї",
  a: "ф", s: "і", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л", l: "д", ";": "ж", "'": "є",
  z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь", ",": "б", ".": "ю", "`": "'",
};

/** The query as it would read had the layout been Ukrainian, or null when it has no English-layout characters. */
export function fromEnglishLayout(query: string): string | null {
  const lower = query.toLowerCase();
  if (!/[a-z,.;'[\]`]/.test(lower)) return null;
  return Array.from(lower).map((ch) => LAYOUT[ch] ?? ch).join("");
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Match every query word against the name's words by prefix (mode "prefix") or as a part of a word ("part"). */
function matchTokens(q: Token[], name: Token[], mode: "prefix" | "part"): { ranges: Range[]; first: boolean } | null {
  if (q.length === 0) return null;
  const ranges: Range[] = [];
  let first = false;
  for (const w of q) {
    let found = false;
    for (let i = 0; i < name.length; i++) {
      const n = name[i];
      if (w.numeric !== n.numeric) continue;
      let at = -1;
      if (w.numeric) at = n.norm === w.norm ? 0 : -1;
      else if (mode === "prefix") at = n.norm.startsWith(w.norm) ? 0 : -1;
      else at = n.norm.indexOf(w.norm);
      if (at < 0) continue;
      // Folding keeps lengths except for units and apostrophes: then the whole word is lit.
      const same = n.end - n.start === n.norm.length;
      ranges.push(same ? [n.start + at, n.start + at + w.norm.length] : [n.start, n.end]);
      if (i === 0 && at === 0 && mode === "prefix") first = true;
      found = true;
      break;
    }
    if (!found) return null;
  }
  return { ranges: mergeRanges(ranges), first };
}

/** Rank groups: lower is better. */
const RANK = { nameStart: 0, wordStart: 1, part: 2, layout: 3 } as const;

export interface ProductSearch<T> {
  search: (query: string, limit?: number) => SearchHit<T>[];
}

/** Index a catalogue once; the returned `search` is cheap enough to run on every keystroke. */
export function createProductSearch<T>(items: T[], getName: (item: T) => string): ProductSearch<T> {
  const entries: Entry<T>[] = items.map((item) => ({ item, name: getName(item), tokens: tokenize(getName(item)) }));
  const collator = new Intl.Collator("uk");

  const run = (query: string, extra: number): { entry: Entry<T>; ranges: Range[]; rank: number }[] => {
    const q = tokenize(query);
    if (q.length === 0) return [];
    const hits: { entry: Entry<T>; ranges: Range[]; rank: number }[] = [];
    for (const entry of entries) {
      const m = matchTokens(q, entry.tokens, "prefix");
      if (m) hits.push({ entry, ranges: m.ranges, rank: (m.first ? RANK.nameStart : RANK.wordStart) + extra });
    }
    if (hits.length > 0) return hits;
    for (const entry of entries) {
      const m = matchTokens(q, entry.tokens, "part");
      if (m) hits.push({ entry, ranges: m.ranges, rank: RANK.part + extra });
    }
    return hits;
  };

  return {
    search(query, limit = 50) {
      const trimmed = query.trim();
      if (!trimmed) return [...entries].sort((a, b) => collator.compare(a.name, b.name)).slice(0, limit).map((e) => ({ item: e.item, ranges: [] }));
      let hits = run(trimmed, 0);
      if (hits.length === 0) {
        // The English-layout reading is looked at only when the plain one found nothing; its punctuation is letters.
        const swapped = fromEnglishLayout(trimmed);
        if (swapped) hits = run(swapped, RANK.layout);
      }
      hits.sort((a, b) => a.rank - b.rank || collator.compare(a.entry.name, b.entry.name));
      return hits.slice(0, limit).map((h) => ({ item: h.entry.item, ranges: h.ranges }));
    },
  };
}

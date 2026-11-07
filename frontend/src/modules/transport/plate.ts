/**
 * Car plates. The same rules as the server (internal/transport): trim, uppercase, drop spaces, dashes and dots,
 * map Latin lookalikes to Cyrillic. A standard plate is two letters, four digits, two letters: `АА 1234 ВВ`.
 */

/** Latin letters that look like a Cyrillic plate letter (plates use only those 12 letters). */
const LOOKALIKE: Record<string, string> = {
  A: "А", B: "В", C: "С", E: "Е", H: "Н", I: "І", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х",
};

export const PLATE_LETTERS = "АВЕІКМНОРСТХ";
const STANDARD = new RegExp(`^[${PLATE_LETTERS}]{2}\\d{4}[${PLATE_LETTERS}]{2}$`);
const LETTER = new RegExp(`^[${PLATE_LETTERS}]$`);

/** The stored form: uppercase Cyrillic without separators. */
export function normalizePlate(raw: string): string {
  return Array.from(raw.trim().toUpperCase().replace(/[\s\-.]+/g, ""))
    .map((ch) => LOOKALIKE[ch] ?? ch)
    .join("");
}

export function isStandardPlate(raw: string): boolean {
  return STANDARD.test(normalizePlate(raw));
}

/** `АА1234ВВ` -> `АА 1234 ВВ`; anything that is not a full standard plate is returned normalised, as typed. */
export function displayPlate(raw: string): string {
  const n = normalizePlate(raw);
  return STANDARD.test(n) ? `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}` : n;
}

/**
 * The text field's value while typing. A standard plate (even a half-typed one) gets its spaces; text that does not
 * fit the shape is left normalised, not cut, so nobody loses what they typed.
 */
export function formatPlateInput(raw: string, nonstandard: boolean): string {
  const n = normalizePlate(raw);
  if (nonstandard) return n.slice(0, 20);
  const shaped = Array.from(n).every((ch, i) => (i < 2 || i >= 6 ? LETTER.test(ch) : /^\d$/.test(ch))) && n.length <= 8;
  if (!shaped) return n.slice(0, 20);
  return [n.slice(0, 2), n.slice(2, 6), n.slice(6, 8)].filter(Boolean).join(" ");
}

export type PlateProblem = "empty" | "format";

/** What is wrong with the typed plate, or null when it can be saved. */
export function plateProblem(raw: string, nonstandard: boolean): PlateProblem | null {
  const n = normalizePlate(raw);
  if (!n) return "empty";
  if (nonstandard) return n.length >= 3 && n.length <= 20 ? null : "format";
  return STANDARD.test(n) ? null : "format";
}

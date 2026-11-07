/**
 * When an order is due, relative to today: the mark a desk and the dispatcher read first. An order for today
 * is urgent; one for a later day stays in work until that day (paid now, buried in a week) and must not get
 * lost; one for a past day that is still open was never closed.
 */

import { shiftDay } from "@/platform/i18n";

export type TimingKind = "overdue" | "today" | "tomorrow" | "dayAfter" | "later" | "past";

/** Statuses still being worked on. done, rejected and cancelled close an order. */
export const OPEN_STATUSES = ["submitted", "accepted", "in_progress", "bumped"] as const;

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Whole calendar days from today to day (negative in the past). */
export function daysFrom(today: string, day: string): number {
  const at = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((at(day) - at(today)) / 86_400_000);
}

export function dayTiming(day: string, today: string): { kind: TimingKind; days: number } {
  const n = daysFrom(today, day);
  if (n < 0) return { kind: "past", days: n };
  if (n === 0) return { kind: "today", days: 0 };
  if (n === 1) return { kind: "tomorrow", days: 1 };
  if (n === 2) return { kind: "dayAfter", days: 2 };
  return { kind: "later", days: n };
}

/** The timing of an order: a past day only matters while the order is still open. */
export function orderTiming(serviceDate: string, status: string, today: string): { kind: TimingKind; days: number } {
  const t = dayTiming(serviceDate, today);
  return t.kind === "past" && isOpen(status) ? { ...t, kind: "overdue" } : t;
}

/** Ukrainian plural: 1 день, 2 дні, 5 днів. */
export function daysWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return `${Math.abs(n)} днів`;
  if (b === 1) return `${Math.abs(n)} день`;
  if (b >= 2 && b <= 4) return `${Math.abs(n)} дні`;
  return `${Math.abs(n)} днів`;
}

/** Days of the strip: start and the next count-1 days. */
export function stripDays(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(start, i));
}

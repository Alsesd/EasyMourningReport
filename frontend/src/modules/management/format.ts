/** Formats a dashboard figure by its unit (the server sends numbers with a unit, never preformatted text). */

import { formatCurrency, uk } from "@/modules/management/i18n";

export type DashUnit = "count" | "money_cents" | "percent" | "minutes";

const countFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export function formatDashValue(unit: DashUnit, value: number): string {
  switch (unit) {
    case "money_cents":
      return formatCurrency(value);
    case "percent":
      return `${Math.round(value)}\u00a0%`;
    case "minutes":
      return uk.management.minutes(value);
    default:
      return countFormat.format(value).replace(/\u202f/g, "\u00a0");
  }
}

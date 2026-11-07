/** Management-module strings. Shared shell strings and formatters come from the platform dictionary. */

import { ukPlatform } from "@/platform/i18n";

export { formatCurrency, todayIso } from "@/platform/i18n";

export const uk = {
  ...ukPlatform,

  nav: { ...ukPlatform.nav, dashboard: "Показники", dashboardShort: "Показники" },

  management: {
    title: "Показники для керівництва",
    subtitle: "Бізнес-показники за вибраний місяць. Технічний стан програми — в розділі «Адміністрування».",
    month: "Місяць",
    previousMonth: "Попередній місяць",
    nextMonth: "Наступний місяць",
    empty: "Показників для вашої ролі немає.",
    partial: "Місяць ще не завершено",
    maxLabel: "Найбільше",
    lastLabel: "Останній",
    table: "Усі значення таблицею",
    noData: "Даних за цей період немає.",
    minutes: (m: number) => (m < 60 ? `${Math.round(m)} хв` : `${Math.floor(m / 60)} год ${Math.round(m % 60)} хв`),
  },
};

/**
 * Reports-module strings. Shared shell strings and formatters come from the platform dictionary.
 */

import { ukPlatform } from "@/platform/i18n";

export {
  formatMoney,
  formatCurrency,
  parseCents,
  formatPeriodReadable,
  shiftPeriod,
  formatDateTime,
} from "@/platform/i18n";

export const uk = {
  ...ukPlatform,

  store: {
    previousMonth: "Попередній місяць",
    nextMonth: "Наступний місяць",
    statusSent: "Надіслано",
    statusDraft: "Чернетка",
    statusNew: "Новий",
    quantity: "Кількість",
    calculationQuantity: "Кількість по розрахунку",
    decreaseQuantity: "Зменшити кількість",
    increaseQuantity: "Збільшити кількість",
    priceOldTag: "стара ціна",
    priceNewTag: "нова ціна",
    priceSavedTag: "раніше збережена",
    inactiveSectionTitle: "Неактивні позиції",
    inactiveHelp: "Позиції, зняті з продажу, але зафіксовані у цьому місяці",
    monthTotal: "Загалом за місяць",
    saveDraft: "Зберегти чернетку",
    savingDraft: "Зберігаю…",
    submitReport: "Надіслати звіт",
    draftSaved: "Чернетку збережено.",
    reportSubmitted: "Звіт надіслано й заблоковано. Розблокувати його може лише адміністратор.",
    confirmSubmitTitle: "Надіслати звіт?",
    confirmSubmitMessage: "Після відправлення звіт стане доступним лише для читання. Змінити його зможе лише адміністратор, розблокувавши звіт.",
    confirmSubmitButton: "Так, надіслати",
    cancelButton: "Скасувати",
    readOnlyBanner: "Звіт надіслано й заблоковано для редагування.",
    unsavedChanges: "Є незбережені зміни",
    unsavedBeforeUnload: "У вас є незбережені зміни у звіті. Якщо ви залишите сторінку, вони будуть втрачені.",
    offlineBadge: "Офлайн-режим",
    pendingSyncBadge: "Очікує синхронізації",
    desktopMode: "Табличний режим",
    cardsMode: "Картковий режим",
  },

  summary: {
    title: "Зведений звіт",
    submittedOnly: "Лише надіслані",
    downloadXlsx: "Завантажити Excel",
    kpiTotal: "Загальна сума",
    kpiSubmittedReports: "Надіслано звітів",
    tableProduct: "Товар",
    tablePrice: "Ціна",
    tableTotalQuantity: "К-сть",
    tableCalculationQuantity: "Кількість по розрахунку",
    tableCalculationQuantityTotal: "По розрахунку (разом)",
    tableTotalSum: "Сума",
    grandTotal: "Загальний підсумок",
    noData: "Немає даних за цей період",
    viewModeTable: "Таблиця",
    viewModeCards: "Картки по товарах",
  },

  reports: {
    title: "Звіти магазинів",
    noReports: "Немає звітів за обраний період",
    unlockReport: "Розблокувати звіт",
    lockReport: "Заблокувати звіт",
    unlockConfirmTitle: "Розблокувати звіт?",
    unlockConfirmMessage: "Магазин знову зможе редагувати та зберігати звіт.",
    lockConfirmTitle: "Заблокувати звіт?",
    lockConfirmMessage: "Звіт стане доступним лише для читання для магазину.",
  },

  settings: {
    title: "Налаштування та довідники",
    tabs: {
      products: "Товари й ціни",
      productsDescription: "Каталог для звітів, історія цін, імпорт з Excel.",
      reportSettings: "Звіти організацій",
      reportSettingsDescription: "Режим «По розрахунку» для окремих організацій.",
    },
    reportSettings: {
      title: "Режим «По розрахунку»",
      description:
        "Для увімкнених організацій у звіті з'являється окрема кількість «по розрахунку». Вона не впливає на суми.",
      reportsCount: (n: number) => `Звітів: ${n}`,
      enabled: "Увімкнено",
      updated: "Налаштування звітів збережено.",
      empty: "Організацій ще немає.",
    },
  },
};

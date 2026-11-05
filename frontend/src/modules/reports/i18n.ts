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
    monthLabel: "Місяць звіту",
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
    offlineNotice: "Немає зв'язку. Зміни зберігаються на цьому пристрої й надішлються, щойно з'явиться мережа.",
    filledOf: (filled: number, total: number) => `заповнено ${filled} з ${total}`,
    calculationShort: "по розрахунку",
    productsLabel: "Товари звіту",
    periodLabel: "Місяць",
    loadError: "Не вдалося завантажити звіт.",
    saveError: "Не вдалося зберегти звіт.",
    retry: "Спробувати знову",
  },

  summary: {
    title: "Зведений звіт",
    submittedOnly: "Лише надіслані",
    downloadXlsx: "Завантажити Excel",
    kpiTotal: "Загальна сума",
    kpiSubmittedReports: "Надіслано звітів",
    kpiQuantity: "Одиниць за місяць",
    tableProduct: "Товар",
    tablePrice: "Ціна",
    tableTotalQuantity: "Кількість",
    tableCalculationQuantity: "Кількість по розрахунку",
    tableCalculationQuantityTotal: "По розрахунку (разом)",
    tableTotalSum: "Сума",
    grandTotal: "Загальний підсумок",
    noData: "Немає даних за цей період",
    viewModeTable: "Таблиця",
    viewModeCards: "Картки по товарах",
  },

  month: {
    crumb: "Звіти",
    storesTitle: "Магазини",
    storesDescription: "Стан звіту кожного магазину за місяць. Відкрийте рядок, щоб переглянути звіт.",
    productsTitle: "Товари за місяць",
    productsDescription: "Кількість за товарами й магазинами, як у файлі Excel.",
    submittedOf: (sent: number, total: number) => `Надіслано ${sent} з ${total}`,
    notReported: (n: number) => (n === 0 ? "усі магазини звітували" : `без звіту: ${n}`),
    monthTotal: "Разом за місяць",
    positions: (n: number) => {
      const mod10 = n % 10;
      const mod100 = n % 100;
      const word = mod10 === 1 && mod100 !== 11 ? "позиція" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "позиції" : "позицій";
      return `${n} ${word}`;
    },
    noReportYet: "звіт ще не почато",
    archived: "в архіві",
    loading: "Завантажую звіти…",
    loadingSummary: "Формую зведення…",
    loadError: "Не вдалося завантажити звіти.",
    retry: "Повторити",
    byStore: "За магазинами",
    allReports: "Усі звіти",
  },

  detail: {
    backToMonth: (month: string) => `Звіти, ${month.toLocaleLowerCase("uk-UA")}`,
    backToReports: "Звіти",
    loading: "Завантажую звіт…",
    loadError: "Не вдалося завантажити звіт.",
    linesTitle: "Позиції звіту",
    noLines: "Кількостей у звіті ще немає.",
    archivedProduct: "в архіві",
    inactiveProduct: "неактивний",
    total: "Разом",
    locked: "Звіт заблоковано.",
    unlocked: "Звіт розблоковано.",
    statusError: "Не вдалося змінити стан звіту.",
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
      disabled: "Вимкнено",
      updated: "Налаштування звітів збережено.",
      empty: "Організацій ще немає.",
    },
  },
};

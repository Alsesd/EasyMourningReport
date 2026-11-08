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
  formatDayReadable,
  formatDayShort,
} from "@/platform/i18n";

export const uk = {
  ...ukPlatform,

  signature: {
    submittedBy: "Надіслав(ла)",
    lockedBy: "Заблокував(ла) адміністратор",
    lastSubmittedBy: "Востаннє надіслав(ла)",
  },

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
    saveDraft: "Зберегти чернетку",
    savingDraft: "Зберігаю…",
    confirmSubmitButton: "Так, надіслати",
    cancelButton: "Скасувати",
    unsavedChanges: "Є незбережені зміни",
    unsavedBeforeUnload: "У вас є незбережені зміни у звіті. Якщо ви залишите сторінку, вони будуть втрачені.",
    offlineNotice: "Немає зв'язку. Зміни зберігаються на цьому пристрої й надішлються, щойно з'явиться мережа.",
    filledOf: (filled: number, total: number) => `заповнено ${filled} з ${total}`,
    calculationShort: "по розрахунку",
    productsLabel: "Товари звіту",
    loadError: "Не вдалося завантажити звіт.",
    saveError: "Не вдалося зберегти звіт.",
    retry: "Спробувати знову",
  },

  daily: {
    stripLabel: "Дні місяця",
    month: "Місяць",
    undated: "Без дати, внесено за весь місяць",
    undatedShort: "Без дати",
    empty: "не заповнено",
    today: "сьогодні",
    dayTotal: "Разом за день",
    submitDay: "Надіслати день",
    daySaved: "Чернетку дня збережено.",
    daySubmitted: "Звіт за день надіслано й заблоковано. Розблокувати його може лише адміністратор.",
    confirmSubmitTitle: "Надіслати звіт за день?",
    confirmSubmitMessage: "Після відправлення звіт за цей день стане доступним лише для читання. Змінити його зможе лише адміністратор, розблокувавши день.",
    dayLabel: "День",
    dayReadOnly: "Звіт за цей день надіслано й заблоковано.",
    monthLocked: "Звіт за місяць надіслано й заблоковано. Щоб вносити дні, попросіть адміністратора розблокувати його.",
    undatedNotice: (sum: string) => `За цей місяць уже внесено ${sum} без дати. У день вносьте лише продажі цього дня.`,
    monthReviewOnly: "Звіт за місяць лише для перегляду: це сума днів. Щоб заблокувати чи розблокувати, відкрийте потрібний день.",
    monthReviewOnlyEmpty: "Звіт за місяць лише для перегляду. Днів у ньому ще немає.",
    missed: "Не надіслано вчасно",
    missedLate: "Надіслано із запізненням",
    missedShort: "не надіслано вчасно",
    autoLocked: (at: string) => `Закрито автоматично опівночі · ${at}`,
    storeMissed: "Звіт за цей день не надіслано вчасно: день закрито автоматично опівночі. Змінити його можна, лише якщо адміністратор розблокує день.",
    storeClosed: "Цей день закрито опівночі, звіт за нього не вносили. Змінити його можна, лише якщо адміністратор розблокує день.",
    storeAutoLocked: "День закрито автоматично опівночі.",
    openUntilMidnight: "Надішліть звіт до 00:00. Опівночі день закривається автоматично, а ненадісланий звіт позначається для адміністрації.",
    reopenedUntilMidnight: "Адміністратор розблокував цей день: виправте й надішліть до 00:00, інакше день знову закриється.",
    closedChip: "закрито",
    missedTitle: "Не надіслано вчасно",
    missedDescription: "Дні, звіт за які підрозділ не надіслав до півночі. Позначка лишається, навіть якщо звіт надіслали пізніше.",
    missedDays: (n: number) => {
      const mod10 = n % 10;
      const mod100 = n % 100;
      const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дні" : "днів";
      return `${n} ${word}`;
    },
    lateMark: "пізніше",
    lastSaved: (by: string, at: string) => `Востаннє зберіг(ла): ${by} · ${at}`,
    reload: "Оновити дані",
    staleDraft: "Поки ви редагували, колега зберіг(ла) цей день. Показано збережені дані; ваші незбережені зміни не застосовано, внесіть їх ще раз за потреби.",
    tabsLabel: "Огляд звітів",
    tabDay: "За день",
    tabMonth: "За місяць",
    monthTabNote: "Лише перегляд: суми днів за місяць. Блокування — в окремих днях.",
    undatedHelp: "Кількості, внесені за весь місяць до переходу на щоденні звіти. Їх можна виправити й надіслати, як окремий день.",
    noLines: "Кількостей ще немає.",
    daysSubmittedOf: (sent: number, total: number) => `днів надіслано ${sent} з ${total}`,
    lockDay: "Заблокувати день",
    unlockDay: "Розблокувати день",
    lockDayTitle: "Заблокувати звіт за день?",
    lockDayMessage: "Звіт за цей день стане доступним підрозділу лише для читання.",
    unlockDayTitle: "Розблокувати звіт за день?",
    unlockDayMessage: "Підрозділ знову зможе змінити й надіслати звіт за цей день.",
    dayLocked: "День заблоковано.",
    dayUnlocked: "День розблоковано.",
    pickDay: "День для перегляду",
    dayStoresDescription: "Стан звіту кожного підрозділу за обраний день. Відкрийте рядок, щоб переглянути день.",
    dayProductsTitle: "Товари за день",
    dayProductsDescription: "Кількість за товарами й підрозділами за обраний день.",
    noDayReport: "день не заповнено",
  },

  summary: {
    title: "Зведений звіт",
    submittedOnly: "Лише надіслані",
    downloadXlsx: "Завантажити Excel",
    tableProduct: "Товар",
    tablePrice: "Ціна",
    tableTotalQuantity: "Кількість",
    tableCalculationQuantity: "Кількість по розрахунку",
    tableCalculationQuantityTotal: "По розрахунку (разом)",
    tableTotalSum: "Сума",
    grandTotal: "Загальний підсумок",
    noData: "Немає даних за цей період",
  },

  month: {
    crumb: "Звіти",
    storesTitle: "Підрозділи",
    storesDescription: "Стан звіту кожного підрозділу за місяць. Відкрийте рядок, щоб переглянути звіт.",
    productsTitle: "Товари за місяць",
    productsDescription: "Кількість за товарами й підрозділами, як у файлі Excel.",
    submittedOf: (sent: number, total: number) => `Надіслано ${sent} з ${total}`,
    noDivisions: "Підрозділів ще немає",
    notReported: (n: number) => (n === 0 ? "усі підрозділи звітували" : `без звіту: ${n}`),
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
    statusError: "Не вдалося змінити стан звіту.",
  },

  reports: {
    title: "Звіти підрозділів",
    noReports: "Немає звітів за обраний період",
  },

  settings: {
    title: "Налаштування та довідники",
    tabs: {
      products: "Товари й ціни",
      productsDescription: "Каталог для звітів, історія цін, імпорт з Excel.",
      reportSettings: "Звіти підрозділів",
      reportSettingsDescription: "Режим «По розрахунку» для окремих підрозділів.",
    },
    reportSettings: {
      title: "Режим «По розрахунку»",
      description:
        "Для увімкнених підрозділів у звіті з'являється окрема кількість «по розрахунку». Вона не впливає на суми.",
      reportsCount: (n: number) => `Звітів: ${n}`,
      enabled: "Увімкнено",
      disabled: "Вимкнено",
      updated: "Налаштування звітів збережено.",
      empty: "Підрозділів ще немає.",
    },
  },
};

/**
 * Ukrainian localization dictionary and formatting utilities.
 * All user-facing strings live here.
 */

export const uk = {
  appTitle: "Легкий звіт",
  appSubtitle: "щомісячні товарні звіти",

  // Auth
  auth: {
    loginTitle: "Вхід до системи",
    loginDescription: "Введіть логін та пароль для доступу",
    portalEyebrow: "Внутрішній портал",
    portalHeadline: "Щоденна звітність — впорядковано й надійно.",
    portalDescription: "Єдиний робочий простір для обліку товарів, звітів магазинів і адміністративних операцій.",
    secureAccess: "Захищений доступ для співробітників",
    dataPrivacyNote: "Використовуйте службовий обліковий запис. Не передавайте пароль іншим особам.",
    credentialsRequired: "Введіть логін і пароль для входу.",
    workspaceLabel: "Робочий простір",
    loginLabel: "Логін",
    passwordLabel: "Пароль",
    showPassword: "Показати пароль",
    hidePassword: "Приховати пароль",
    submitButton: "Увійти",
    submittingButton: "Вхід…",
    logoutButton: "Вийти",
    invalidCredentials: "Неправильний логін або пароль",
    accountDisabled: "Цей обліковий запис вимкнено. Зверніться до адміністратора.",
    rateLimited: "Забагато невдалих спроб. Спробуйте пізніше.",
    networkError: "Помилка зв’язку із сервером. Перевірте з’єднання.",
  },

  // Navigation & Shell
  nav: {
    portalLabel: "Внутрішній портал",
    workspaceLabel: "Робочий простір",
    report: "Звіт",
    summary: "Зведений",
    reports: "Звіти",
    settings: "Налаштування",
    settingsShort: "Параметри",
    logs: "Журнал",
    themeToggle: "Тема оформлення",
    themeLight: "Світла тема",
    themeDark: "Темна тема",
    themeSystem: "Системна",
  },

  // Store Report Screen
  store: {
    previousMonth: "Попередній місяць",
    nextMonth: "Наступний місяць",
    statusSent: "Надіслано",
    statusDraft: "Чернетка",
    statusNew: "Новий",
    quantity: "Кількість",
    decreaseQuantity: "Зменшити кількість",
    increaseQuantity: "Збільшити кількість",
    priceOldTag: "стара ціна",
    priceNewTag: "нова ціна",
    priceSavedTag: "раніше збережена",
    inactiveSectionTitle: "Неактивні позиції",
    inactiveSectionEmpty: "Немає неактивних позицій із залишками",
    inactiveHelp: "Позиції, зняті з продажу, але зафіксовані у цьому місяці",
    monthTotal: "Загалом за місяць",
    saveDraft: "Зберегти чернетку",
    savingDraft: "Зберігаю…",
    submitReport: "Надіслати звіт",
    submittingReport: "Надсилаю…",
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
    syncedBadge: "Синхронізовано",
    desktopMode: "Табличний режим",
    cardsMode: "Картковий режим",
  },

  // Admin Summary
  summary: {
    title: "Зведений звіт",
    submittedOnly: "Лише надіслані",
    downloadXlsx: "Завантажити Excel",
    kpiTotal: "Загальна сума",
    kpiStoresWithReport: "Магазинів зі звітом",
    kpiTotalStores: "Всього магазинів",
    kpiSubmittedReports: "Надіслано звітів",
    tableStore: "Магазин",
    tableProduct: "Товар",
    tablePrice: "Ціна",
    tableTotalQuantity: "К-сть",
    tableTotalSum: "Сума",
    grandTotal: "Загальний підсумок",
    noData: "Немає даних за цей період",
    viewModeTable: "Таблиця",
    viewModeCards: "Картки по товарах",
  },

  // Admin Reports List & Detail
  reports: {
    title: "Звіти магазинів",
    periodLabel: "Період",
    storeColumn: "Магазин",
    statusColumn: "Статус",
    itemsColumn: "Позицій",
    sumColumn: "Сума",
    noReports: "Немає звітів за обраний період",
    detailTitle: "Звіт магазину",
    unlockReport: "Розблокувати звіт",
    lockReport: "Заблокувати звіт",
    unlockConfirmTitle: "Розблокувати звіт?",
    unlockConfirmMessage: "Магазин знову зможе редагувати та зберігати звіт.",
    lockConfirmTitle: "Заблокувати звіт?",
    lockConfirmMessage: "Звіт стане доступним лише для читання для магазину.",
    reportLockedNotice: "Звіт заблоковано.",
    reportUnlockedNotice: "Звіт розблоковано.",
  },

  // Admin Settings
  settings: {
    title: "Налаштування та довідники",
    tabs: {
      products: "Товари",
      stores: "Магазини",
      security: "Безпека",
      tunnel: "Публічний доступ",
      backup: "Резервні копії",
    },
    products: {
      searchPlaceholder: "Пошук товарів…",
      addProduct: "Створити товар",
      nameLabel: "Назва товару",
      priceLabel: "Ціна (грн)",
      activeToggle: "Активний у звітах",
      saveProduct: "Зберегти",
      saving: "Зберігаю…",
      productCreated: "Товар успішно створено.",
      productUpdated: "Зміни збережено.",
      archiveProduct: "В архів",
      restoreProduct: "Відновити",
      confirmArchive: "Перемістити товар в архів?",
      confirmDelete: "Видалити товар назавжди?",
      activeSection: "Активні товари",
      inactiveSection: "Неактивні товари",
      archivedSection: "Архів товарів",
      changePrice: "Змінити ціну",
      closePriceEditor: "Закрити",
      priceHistoryTitle: "Історія ціни у поточному місяці",
      priceChangeNote: "Нова ціна діятиме з обраного місяця. Попередні звіти залишаться без змін.",
      importTitle: "Імпорт товарів з Excel (.xlsx)",
      importFileLabel: "Оберіть файл Excel",
      importButton: "Імпортувати товари",
      importing: "Імпортую…",
      importSuccess: "Імпорт успішно завершено.",
    },
    stores: {
      addStore: "Створити магазин",
      nameLabel: "Назва магазину",
      loginLabel: "Логін магазину",
      passwordLabel: "Пароль",
    showPassword: "Показати пароль",
    hidePassword: "Приховати пароль",
      resetPassword: "Змінити пароль",
      newPasswordLabel: "Новий пароль",
      saveStore: "Зберегти",
      storeCreated: "Магазин успішно створено.",
      storeUpdated: "Дані магазину оновлено.",
      passwordReset: "Пароль успішно змінено.",
      archiveStore: "В архів",
      restoreStore: "Відновити",
      confirmArchive: "Перемістити магазин в архів? Його співробітники не зможуть увійти.",
      activeSection: "Активні магазини",
      archivedSection: "Архів магазинів",
    },
    security: {
      title: "Зміна пароля адміністратора",
      currentAdminPassword: "Новий пароль адміністратора",
      minChars: "Мінімум 6 символів",
      changeButton: "Змінити пароль адміністратора",
      changedSuccess: "Пароль адміністратора успішно оновлено.",
    },
    tunnel: {
      title: "Публічний доступ через інтернет",
      subtitle: "Cloudflare Tunnel забезпечує безпечний доступ без білої IP-адреси",
      statusLabel: "Статус підключення",
      statusRunning: "Підключено",
      statusStarting: "Підключення…",
      statusStopped: "Зупинено",
      statusDisabled: "Вимкнено",
      statusError: "Помилка підключення",
      liveUrl: "Публічна адреса",
      openLiveUrl: "Відкрити публічне посилання",
      startTunnel: "Увімкнути доступ",
      stopTunnel: "Вимкнути доступ",
      autostartToggle: "Автозапуск при старті системи",
      authKeyLabel: "Токен тунелю (необов’язково для Quick Tunnel)",
    },
    backup: {
      title: "Резервне копіювання бази даних",
      description: "Завантажте актуальну резервну копію SQLite бази даних на свій комп’ютер",
      downloadButton: "Завантажити резервну копію (.db)",
    },
  },

  // Audit Logs
  logs: {
    title: "Журнал аудиту",
    filterAction: "Дія",
    allActions: "Усі дії",
    filterLogin: "Логін користувача",
    searchPlaceholder: "Пошук за логіном…",
    timestampColumn: "Час",
    userColumn: "Користувач",
    roleColumn: "Роль",
    actionColumn: "Дія",
    detailsColumn: "Деталі",
    ipColumn: "IP-адреса",
    noLogs: "Записів у журналі не знайдено",
  },

  // Common actions & dialogs
  common: {
    loading: "Завантаження…",
    save: "Зберегти",
    cancel: "Скасувати",
    delete: "Видалити",
    edit: "Редагувати",
    close: "Закрити",
    actions: "Дії",
    error: "Помилка",
    success: "Успішно",
    confirmTitle: "Підтвердження",
    currencySymbol: "₴",
  },
};

/**
 * Format price in cents as decimal string (e.g. 2500 -> "25.00").
 * Matches `cents / 100:.2f` from backend and legacy UI.
 */
export function formatMoney(cents: number | null | undefined): string {
  const value = Number(cents || 0);
  return (value / 100).toFixed(2);
}

/**
 * Format price with Ukrainian currency symbol (e.g. 2500 -> "25.00 ₴").
 */
export function formatCurrency(cents: number | null | undefined): string {
  return `${formatMoney(cents)} ₴`;
}

/**
 * Parse money string (like "25.50" or "25,50") into integer cents.
 */
export function parseCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.round(value);
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

const MONTH_NAMES_UK = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
];

/**
 * Format period string "YYYY-MM" to "Місяць YYYY" (e.g. "2026-10" -> "Жовтень 2026").
 */
export function formatPeriodReadable(period: string): string {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period;
  const [yearStr, monthStr] = period.split("-");
  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES_UK[monthIdx] || monthStr;
  return `${monthName} ${yearStr}`;
}

/**
 * Shift period "YYYY-MM" by delta months (+1 or -1).
 */
export function shiftPeriod(period: string, delta: number): string {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}`;
}

/**
 * Format ISO datetime string to Ukrainian readable date and time.
 */
export function formatDateTime(isoString: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("uk-UA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

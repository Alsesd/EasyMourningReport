/**
 * Ukrainian strings and formatting helpers shared by the platform and every module.
 * Modules extend this dictionary with their own strings (see modules/reports/i18n.ts).
 */

export const ukPlatform = {
  appTitle: "Легкий звіт",
  appSubtitle: "щомісячні товарні звіти",

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

  nav: {
    portalLabel: "Внутрішній портал",
    workspaceLabel: "Робочий простір",
    report: "Звіт",
    summary: "Зведений",
    reports: "Звіти",
    settings: "Налаштування",
    settingsShort: "Параметри",
    logs: "Журнал",
    access: "Користувачі",
    accessShort: "Доступ",
    storeReport: "Звіт магазину",
    transport: "Транспорт",
    themeToggle: "Тема оформлення",
    themeLight: "Світла тема",
    themeDark: "Темна тема",
    themeSystem: "Системна",
  },

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
    quantity: "Кількість",
    decreaseQuantity: "Зменшити кількість",
    increaseQuantity: "Збільшити кількість",
  },

  settingsHost: {
    title: "Налаштування",
    subtitle: "Довідники, доступ і системні параметри",
    empty: "Для вашого облікового запису немає доступних налаштувань.",
  },

  account: {
    tab: "Мій пароль",
    title: "Зміна власного пароля",
    description: "Введіть новий надійний пароль для свого облікового запису (мінімум 6 символів).",
    newPassword: "Новий пароль",
    placeholder: "Введіть новий пароль",
    minChars: "Мінімум 6 символів",
    changeButton: "Змінити пароль",
    changed: "Ваш пароль змінено.",
  },

  system: {
    tunnelTab: "Публічний доступ",
    backupTab: "Резервні копії",
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

  access: {
    title: "Користувачі та доступ",
    subtitle: "Організації, облікові записи та ролі з дозволами",
    tabs: { users: "Користувачі", organisations: "Організації", roles: "Ролі" },
    platformStaff: "Працівники платформи",
    allUsers: "Усі",
    noOrganisation: "Платформа",
    loginLabel: "Логін",
    fullNameLabel: "Ім'я (необов'язково)",
    passwordLabel: "Пароль",
    organisationLabel: "Організація",
    rolesLabel: "Ролі",
    activeLabel: "Активний",
    inactive: "Вимкнено",
    addUser: "Додати користувача",
    newUser: "Новий користувач",
    editUser: "Редагувати користувача",
    resetPassword: "Новий пароль",
    resetPasswordButton: "Змінити пароль",
    deleteUser: "Видалити користувача",
    confirmDeleteUser: (login: string) => `Видалити обліковий запис «${login}»? Записи в журналі залишаться.`,
    noUsers: "Користувачів не знайдено.",
    noRoles: "Немає ролей, які можна призначити.",
    addOrganisation: "Додати організацію",
    newOrganisation: "Нова організація",
    organisationName: "Назва організації",
    firstUserHint: "Можна одразу створити перший обліковий запис із роллю «Магазин».",
    firstUserLogin: "Логін першого користувача (необов'язково)",
    firstUserPassword: "Пароль першого користувача",
    usersCount: (n: number) => `Користувачів: ${n}`,
    archive: "В архів",
    restore: "Відновити",
    archived: "В архіві",
    archivedSection: "Архів організацій",
    confirmArchive: (name: string) =>
      `Організацію «${name}» буде архівовано, якщо в неї є дані, або видалено разом із користувачами, якщо даних немає. Її користувачі не зможуть увійти.`,
    roleName: "Назва ролі",
    addRole: "Створити роль",
    newRole: "Нова роль",
    editRole: "Редагувати роль",
    scopeLabel: "Для кого",
    scopePlatform: "Працівники платформи",
    scopeOrganisation: "Користувачі організацій",
    roleOrganisation: "Доступна організаціям",
    allOrganisations: "Усім організаціям",
    builtIn: "Вбудована",
    allPermissions: "Має всі дозволи свого типу, зокрема дозволи нових модулів.",
    permissionsLabel: "Дозволи",
    roleUsers: (n: number) => `Призначено: ${n}`,
    deleteRole: "Видалити роль",
    confirmDeleteRole: (name: string) => `Видалити роль «${name}»? Користувачі втратять її дозволи.`,
    saved: "Зміни збережено.",
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

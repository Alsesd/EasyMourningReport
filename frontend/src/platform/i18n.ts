/**
 * Ukrainian strings and formatting helpers shared by the platform and every module.
 * Modules extend this dictionary with their own strings (see modules/reports/i18n.ts).
 */

export const ukPlatform = {
  appTitle: "Легкий звіт",
  appSubtitle: "внутрішня платформа ритуальних служб",

  auth: {
    loginTitle: "Вхід до системи",
    loginDescription: "Увійдіть службовим обліковим записом.",
    loginPlaceholder: "Ваш логін",
    portalDescription: "Робочий простір для магазинів і служб: щомісячні звіти, довідники, облікові записи та журнал дій.",
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
    networkError: "Помилка зв’язку із сервером. Перевірте з’єднання.",
  },

  nav: {
    portalLabel: "Внутрішній портал",
    workspaceLabel: "Робочий простір",
    report: "Звіт",
    reports: "Звіти",
    settings: "Налаштування",
    logs: "Журнал",
    admin: "Адміністрування",
    adminShort: "Адмін",
    storeReport: "Звіт магазину",
    transport: "Транспорт",
    themeLight: "Світла тема",
    themeDark: "Темна тема",
    themeSystem: "Системна",
  },

  logs: {
    title: "Журнал аудиту",
    allActions: "Усі дії",
    noLogs: "Записів у журналі не знайдено",
  },

  common: {
    loading: "Завантаження…",
    save: "Зберегти",
    cancel: "Скасувати",
    delete: "Видалити",
    edit: "Редагувати",
    close: "Закрити",
    error: "Помилка",
    quantity: "Кількість",
    decreaseQuantity: "Зменшити кількість",
    increaseQuantity: "Збільшити кількість",
  },

  hub: {
    title: "Адміністрування",
    subtitle: "Доступ, довідники модулів і стан системи",
    menuLabel: "Розділи адміністрування",
    overview: "Огляд",
    groups: {
      access: "Доступ",
      catalog: "Довідники модулів",
      system: "Система",
      activity: "Активність",
    },
    accountsTitle: "Облікові записи",
    organisations: "Організацій",
    archivedOrganisations: (n: number) => `в архіві: ${n}`,
    users: "Користувачів",
    inactiveUsers: (n: number) => `вимкнено: ${n}`,
    roles: "Ролей",
    systemTitle: "Стан системи",
    database: "База даних",
    databaseOk: "Цілісність перевірено",
    databaseProblem: "Проблема цілісності",
    lastBackup: "Остання резервна копія",
    noBackups: "Ще немає",
    backupsKept: (n: number) => `збережено копій: ${n}`,
    publicAccess: "Публічний доступ",
    recentTitle: "Останні дії",
    allActivity: "Увесь журнал",
    sectionsTitle: "Розділи",
    open: "Відкрити",
    noAccessTitle: "Немає доступних розділів",
    noAccessText: "Вашому обліковому запису ще не призначено ролей. Зверніться до адміністратора.",
  },

  account: {
    menuLabel: "Обліковий запис",
    changePassword: "Змінити пароль",
    platformStaff: "Працівник платформи",
    title: "Зміна власного пароля",
    description: "Введіть новий надійний пароль для свого облікового запису (мінімум 6 символів).",
    newPassword: "Новий пароль",
    placeholder: "Введіть новий пароль",
    minChars: "Мінімум 6 символів",
    changeButton: "Змінити пароль",
    changed: "Ваш пароль змінено.",
  },

  system: {
    on: "Увімкнено",
    off: "Вимкнено",
    tunnelTab: "Публічний доступ",
    tunnelDescription: "Cloudflare Tunnel: доступ ззовні без білої IP-адреси.",
    backupTab: "Резервні копії",
    backupDescription: "Автоматичні копії бази, перевірка цілісності, завантаження.",
    states: {
      disabled: "Вимкнено",
      stopped: "Зупинено",
      starting: "Підключення…",
      running: "Підключено",
      error: "Помилка",
    } as Record<string, string>,
    tunnel: {
      title: "Публічний доступ через інтернет",
      subtitle: "Cloudflare Tunnel забезпечує безпечний доступ без білої IP-адреси",
      liveUrl: "Публічна адреса",
      startTunnel: "Увімкнути доступ",
      stopTunnel: "Вимкнути доступ",
      autostartToggle: "Автозапуск при старті системи",
      tokenLabel: "Токен тунелю (необов’язково: без нього відкриється тимчасовий Quick Tunnel)",
    },
    backup: {
      title: "Резервне копіювання бази даних",
      description: "Завантажте актуальну резервну копію SQLite бази даних на свій комп’ютер",
      downloadButton: "Завантажити свіжу копію",
      schedule: (min: number) => `Копія створюється автоматично кожні ${min} хв, якщо були зміни, а також під час запуску й зупинки.`,
      recent: "Останні копії",
      journal: (mode: string) => (mode === "wal" ? "Режим журналу: WAL (локальний диск)." : "Режим журналу: класичний (спільна папка)."),
      size: "Розмір бази",
      integrity: "Цілісність",
    },
  },

  access: {
    sections: {
      users: "Користувачі",
      usersDescription: "Облікові записи, ролі, вимкнення та скидання паролів.",
      organisations: "Організації",
      organisationsDescription: "Магазини та інші організації, архів.",
      roles: "Ролі",
      rolesDescription: "Набори дозволів для працівників і організацій.",
      audit: "Журнал дій",
      auditDescription: "Входи та всі зміни в системі.",
    },
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

const moneyFormat = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Format an amount for reading, the Ukrainian way: grouped thousands, decimal comma and the hryvnia
 * sign (372650 -> "3 726,50 ₴"). Inputs keep `formatMoney`, which a person can type back.
 */
export function formatCurrency(cents: number | null | undefined): string {
  // Intl groups with a narrow no-break space; a plain no-break space keeps every font aligned.
  return `${moneyFormat.format(Number(cents || 0) / 100).replace(/\u202f/g, "\u00a0")}\u00a0₴`;
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

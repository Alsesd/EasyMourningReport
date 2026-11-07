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
    portalDescription: "Робочий простір підрозділів: щомісячні звіти, замовлення транспорту, довідники, облікові записи та журнал дій.",
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
    passkeyButton: "Увійти за біометрією",
    passkeyBusy: "Очікуємо підтвердження на пристрої…",
    passkeyOr: "або",
    passkeyCancelled: "Вхід за ключем доступу скасовано.",
    biometricOfferTitle: "Входити за біометрією?",
    biometricOfferText:
      "Наступного разу на цьому пристрої вхід запропонує відбиток пальця або розпізнавання обличчя замість пароля. Пароль завжди залишається запасним способом.",
    biometricEnable: "Увімкнути",
    biometricLater: "Не зараз",
    biometricDeviceName: "Цей пристрій",
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
    storeReport: "Звіт підрозділу",
    transport: "Транспорт",
    themeLight: "Світла тема",
    themeDark: "Темна тема",
    themeSystem: "Системна",
    uiScale: "Розмір інтерфейсу",
    uiScaleSmaller: "Зменшити інтерфейс",
    uiScaleLarger: "Збільшити інтерфейс",
    uiScaleReset: "Звичайний розмір",
    appearance: "Вигляд: тема й розмір",
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
    firstStepsTitle: "З чого почати",
    firstStepsIntro: "У новій системі є лише адміністратор. Налаштуйте її в кілька кроків.",
    firstStepDivision: "Створіть підрозділи, які працюватимуть у системі",
    firstStepRoles: "Створіть ролі: набір дозволів визначає, що бачить і може робити працівник. Підрозділ визначає, чиї дані він бачить",
    firstStepUsers: "Додайте працівників і призначте їм підрозділ та роль",
    organisations: "Підрозділів",
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

  device: {
    title: "Налаштуйте цей пристрій",
    text: "Два швидкі кроки, щоб нічого не пропустити. Браузер попросить підтвердження.",
    notificationsTitle: "Сповіщення",
    notificationsText: "Повідомлення про статус замовлень, нові звіти й нагадування з’являтимуться на пристрої.",
    enableNotifications: "Увімкнути сповіщення",
    installTitle: "Програма на пристрої",
    installText: "Іконка на робочому столі чи екрані, запуск в окремому вікні.",
    installApp: "Встановити програму",
    installIos: "У Safari програму додають вручну.",
    installIosSteps: "Натисніть «Поділитися», потім «На екран Додому».",
    later: "Пізніше",
  },

  notifications: {
    title: "Сповіщення",
    bell: (unread: number) => (unread > 0 ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"),
    empty: "Сповіщень поки немає.",
    markAll: "Позначити всі прочитаними",
    enableDevice: "Показувати сповіщення на цьому пристрої",
    deviceHint: "Дозвольте сповіщення, щоб бачити нові події на цьому пристрої.",
    deviceOn: "Сповіщення на пристрої дозволено. Щоб перевірити, чи приходять вони й при закритій програмі, надішліть тестове.",
    sendTest: "Надіслати тестове сповіщення",
    sendingTest: "Надсилання…",
    testSent: (devices: number) =>
      devices > 0
        ? `Надіслано. Закрийте програму або заблокуйте екран: сповіщення має прийти за кілька секунд (пристроїв з push: ${devices}).`
        : "Надіслано в дзвінок. Цей пристрій ще не підписаний на push: дозвольте сповіщення в цьому вікні.",
    testNoPush: "Push на сервері не налаштовано: сповіщення приходять лише в дзвінок.",
    deviceDenied: "Браузер заборонив сповіщення. Дозвольте їх у налаштуваннях сайту.",
    unread: "нове",
    unreadCount: (n: number) => `Нових: ${n}`,
    allRead: "Усе прочитано",
  },

  account: {
    menuLabel: "Обліковий запис",
    changePassword: "Змінити пароль",
    platformStaff: "Адміністрація",
    title: "Зміна власного пароля",
    description: "Введіть новий надійний пароль для свого облікового запису (мінімум 8 символів, малі й великі літери та цифри).",
    newPassword: "Новий пароль",
    placeholder: "Введіть новий пароль",
    changeButton: "Змінити пароль",
    changed: "Ваш пароль змінено.",
    passkeys: "Біометрія та ключі доступу",
    passkeysTitle: "Вхід за біометрією",
    passkeysDescription:
      "Додайте відбиток пальця, обличчя або екран блокування цього пристрою, щоб входити без пароля. Біометричні дані не залишають пристрій.",
    passkeysUnsupported: "Цей браузер або з’єднання не підтримує ключі доступу (потрібен https).",
    passkeysEmpty: "Ключів доступу ще немає.",
    passkeyName: "Назва пристрою",
    passkeyNamePlaceholder: "Наприклад, телефон",
    passkeyAdd: "Додати цей пристрій",
    passkeyAdded: "Ключ доступу додано.",
    passkeyRemove: "Видалити",
    passkeyRemoved: "Ключ доступу видалено.",
    passkeyCreated: "Додано",
    passkeyLastUsed: "Останній вхід",
    passkeyNever: "ще не було",
  },

  system: {
    on: "Увімкнено",
    off: "Вимкнено",
    tunnelTab: "Публічний доступ",
    tunnelDescription: "Cloudflare Tunnel: доступ ззовні без білої IP-адреси.",
    updateTab: "Оновлення програми",
    updateDescription: "Нова версія з GitHub: перевірка, встановлення, автоматичний перезапуск.",
    backupTab: "Резервні копії",
    backupDescription: "Автоматичні копії бази, перевірка цілісності, завантаження.",
    healthTab: "Стан програми",
    healthDescription: "Технічні показники: версія, база, копії, фонові завдання, помилки.",
    health: {
      allGood: "Усе гаразд",
      needsAttention: (n: number) => `Потребує уваги: ${n}`,
      updatedHint: "Показники оновлюються кожні 30 секунд.",
      program: "Програма",
      version: "Версія",
      noTag: "без тега релізу",
      dirty: "є незбережені зміни",
      stack: "Складники",
      stackGo: "Go",
      stackSqlite: "SQLite",
      stackReact: "React",
      stackVite: "Vite",
      stackTailwind: "Tailwind CSS",
      pushSent: (sent: number, failed: number, gone: number) => `доставлено ${sent}, збоїв ${failed}, скасованих підписок ${gone}`,
      pushLastFailure: "Остання помилка push",
      devBuild: "розробницька збірка",
      builtAt: "Зібрано",
      platform: "Платформа",
      uptime: "Працює без перезапуску",
      memory: "Пам’ять",
      goroutines: "Потоки виконання",
      database: "База даних",
      integrity: "Цілісність",
      integrityOk: "Перевірка пройдена",
      integrityBad: "Перевірка не пройдена",
      checkedAt: "перевірено",
      recheck: "Перевірити зараз",
      rechecking: "Перевірка…",
      fileSize: "Файл бази",
      walSize: "Журнал (WAL)",
      freePages: "Вільні сторінки",
      disk: "Диск",
      diskFree: (free: string, total: string) => `вільно ${free} із ${total}`,
      diskUnknown: "невідомо",
      rows: "Записи в таблицях",
      tables: {
        users: "Користувачі",
        organisations: "Підрозділи",
        products: "Товари",
        reports: "Звіти",
        report_items: "Рядки звітів",
        transport_orders: "Замовлення транспорту",
        notifications: "Сповіщення",
        audit_log: "Журнал дій",
      } as Record<string, string>,
      backups: "Резервні копії",
      backupJob: "Задача копіювання",
      backupJobOk: "Працює",
      backupJobLate: "Давно не запускалась",
      backupJobFailed: "Остання спроба невдала",
      backupNotConfigured: "Не налаштовано",
      backupLastRun: "Остання перевірка змін",
      backupNewest: "Найновіша копія",
      backupNewestHint: "Копія створюється лише коли дані змінились, тож вона може бути давньою після тихих днів.",
      backupCount: (n: number, size: string) => `Копій: ${n}, разом ${size}`,
      jobs: "Фонові завдання",
      jobNever: "ще не запускалось",
      jobStale: "не запускалось вчасно",
      jobRuns: (runs: number, fails: number) => `запусків ${runs}, помилок ${fails}`,
      access: "Доступ і зв’язок",
      tunnel: "Публічний доступ",
      update: "Оновлення",
      updateAvailable: (v: string) => `Доступна версія ${v}`,
      updateCurrent: "Найновіша версія",
      sessions: "Активні входи",
      sessionsValue: (live: number, users: number) => `${live} входів, ${users} користувачів`,
      push: "Push-сповіщення",
      pushOff: "Не налаштовано",
      pushValue: (subs: number, backlog: number) => `пристроїв ${subs}, у черзі ${backlog}`,
      requests: "Запити з моменту запуску",
      requestsTotal: "Усього запитів",
      clientErrors: "Відмови (4xx)",
      clientErrorsHint: "Прострочений вхід, відсутня сторінка — не збій програми.",
      serverErrors: "Збої програми (5xx)",
      lastServerError: "Останній збій",
      noServerErrors: "немає",
      log: "Журнал помилок і попереджень",
      logHint: "Рядки журналу програми, що містять помилку чи попередження. Однакові підряд об’єднано.",
      logAll: "Усі",
      logErrors: "Помилки",
      logWarnings: "Попередження",
      logEmpty: "Записів немає.",
      logCounts: (errors: number, warnings: number) => `За добу: помилок ${errors}, попереджень ${warnings}`,
      logPersisted: "Записи зберігаються у файлі й переживають перезапуск.",
      logMemoryOnly: "Записи лише в пам’яті: після перезапуску зникнуть.",
      levelError: "Помилка",
      levelWarning: "Попередження",
      times: (n: number) => `×${n}`,
    },
    update: {
      subtitle: "Програма сама перевіряє нові випуски на GitHub, завантажує їх, перевіряє контрольну суму, робить резервну копію і перезапускається.",
      current: "Поточна версія",
      latest: "Остання версія",
      lastChecked: "Остання перевірка",
      never: "ще не було",
      devBuild: "розробницька збірка",
      disabled: "Ця збірка не є випуском із GitHub, тому оновлюватися самостійно не може.",
      auto: "Автоматичне встановлення",
      autoHint: "Вимикається змінною AUTO_UPDATE=0 у файлі .env.",
      available: "Доступна нова версія",
      upToDate: "Встановлено найновішу версію.",
      notWritable: "Тека програми недоступна для запису: оновлення неможливе.",
      check: "Перевірити зараз",
      checking: "Перевірка…",
      apply: "Оновити й перезапустити",
      applying: "Оновлення…",
      restarting: "Програма перезапускається. Сторінка оновиться за кілька секунд.",
      states: {
        idle: "Очікує",
        checking: "Перевірка",
        downloading: "Завантаження",
        restarting: "Перезапуск",
        error: "Помилка",
      } as Record<string, string>,
    },
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
      downloadButton: "Створити копію й завантажити",
      downloadItem: (name: string) => `Завантажити копію ${name}`,
      snapshot: "знімок",
      schedule: (min: number) => `Копія створюється автоматично кожні ${min} хв, якщо змінилися дані (входи й сесії не рахуються), а також під час запуску й зупинки. Час у назві файла — UTC. Знімки для завантаження зберігаються окремо.`,
      recent: "Останні копії",
      journal: (mode: string) => (mode === "wal" ? "Режим журналу: WAL (локальний диск)." : "Режим журналу: класичний (спільна папка)."),
      size: "Розмір бази",
      integrity: "Цілісність",
    },
  },

  sessions: {
    empty: "Активних сеансів немає.",
    device: "Пристрій",
    address: "Адреса",
    started: "Вхід",
    lastSeen: "Остання активність",
    current: "Ви",
    disabledAccount: "обліковий запис вимкнено",
    devicesCount: (n: number) => (n === 1 ? "1 пристрій" : n >= 2 && n <= 4 ? `${n} пристрої` : `${n} пристроїв`),
    endSession: "Завершити сеанс",
    endAll: "Вийти скрізь",
    confirmEnd: (who: string, device: string) => `Завершити сеанс «${who}» на пристрої ${device}? Працівник має увійти знову.`,
    confirmEndAll: (who: string) => `Вивести «${who}» з усіх пристроїв? Працівник має увійти знову.`,
    ended: "Сеанс завершено.",
    endedAll: "Користувача виведено з усіх пристроїв.",
    note: "Час останньої активності оновлюється приблизно раз на 10 хвилин роботи.",
  },

  access: {
    sections: {
      users: "Користувачі",
      usersDescription: "Облікові записи, ролі, вимкнення та скидання паролів.",
      organisations: "Підрозділи",
      organisationsDescription: "Підрозділи, їхні працівники та архів.",
      sessions: "Сеанси",
      sessionsDescription: "Пристрої, з яких працівники увійшли в систему: хто, звідки, коли. Можна завершити сеанс.",
      roles: "Ролі",
      rolesDescription: "Набори дозволів: що працівник бачить і може робити.",
      audit: "Журнал дій",
      auditDescription: "Входи та всі зміни в системі.",
    },
    platformStaff: "Адміністрація (без підрозділу)",
    allUsers: "Усі",
    noOrganisation: "Без підрозділу",
    loginLabel: "Логін",
    fullNameLabel: "Ім'я (необов'язково)",
    passwordLabel: "Пароль",
    organisationLabel: "Підрозділ",
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
    createRoleFirst: "Ролей ще немає: спершу створіть роль у розділі «Ролі». Працівник без ролі нічого не бачить.",
    addOrganisation: "Додати підрозділ",
    newOrganisation: "Новий підрозділ",
    organisationName: "Назва підрозділу",
    createOrganisationButton: "Створити підрозділ",
    employeesTitle: "Працівники",
    employeesHint: "Необов'язково. Додайте тих, хто працюватиме в цьому підрозділі, або зробіть це пізніше в розділі «Користувачі».",
    addEmployee: "Додати працівника",
    removeEmployee: (who: string) => `Прибрати працівника ${who}`,
    employeeRole: "Роль",
    generatePassword: "Згенерувати пароль",
    moveExisting: "Перенести наявних працівників",
    moveExistingHint: "Обліковий запис переходить із поточного підрозділу. Ролі, що діяли лише там, замінюються роллю за замовчуванням.",
    noOtherEmployees: "В інших підрозділах немає працівників.",
    employeeLoginShort: "Логін працівника має містити щонайменше 2 символи.",
    employeePasswordShort: "Пароль працівника: щонайменше 8 символів, малі й великі літери та цифри.",
    employeeDuplicate: (login: string) => `Логін «${login}» повторюється.`,
    organisationCreated: (name: string, created: number, moved: number) => {
      const parts: string[] = [];
      if (created) parts.push(`додано працівників: ${created}`);
      if (moved) parts.push(`перенесено: ${moved}`);
      return `Підрозділ «${name}» створено${parts.length ? ` (${parts.join(", ")})` : ""}.`;
    },
    organisationCreatedWithErrors: (name: string, failures: string[]) =>
      `Підрозділ «${name}» створено, але не все вдалося: ${failures.join("; ")}. Решту можна додати в розділі «Користувачі».`,
    usersCount: (n: number) => `Користувачів: ${n}`,
    archive: "В архів",
    restore: "Відновити",
    archived: "В архіві",
    archivedSection: "Архів підрозділів",
    confirmArchive: (name: string) =>
      `Підрозділ «${name}» буде архівовано, якщо в нього є дані, або видалено разом із користувачами, якщо даних немає. Його користувачі не зможуть увійти.`,
    roleName: "Назва ролі",
    addRole: "Створити роль",
    newRole: "Нова роль",
    scopeLabel: "Для кого",
    scopePlatform: "Адміністрація",
    scopeOrganisation: "Працівники підрозділів",
    roleOrganisation: "Для якого підрозділу (необов’язково)",
    allOrganisations: "Для будь-якого підрозділу",
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

const dayFormat = new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** Today as YYYY-MM-DD in the browser's local calendar. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Shift a YYYY-MM-DD day by delta days (calendar arithmetic, immune to daylight-saving changes). */
export function shiftDay(day: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** "2026-11-06" -> "пт, 6 листопада 2026 р." in Ukrainian, whatever the browser's language. */
export function formatDayReadable(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split("-").map(Number);
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d, 12)));
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

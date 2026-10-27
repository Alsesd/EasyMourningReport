# EasyMourningReport

<div align="center">

![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162%2B-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?logo=tailwindcss&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)
![uv](https://img.shields.io/badge/Package-uv-DE5FE9?logo=astral&logoColor=white)
![Docker](https://img.shields.io/badge/Deployment-Docker--Compose-2496ED?logo=docker&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-success)

</div>

Легкий, надійний та зручний веб-застосунок корпоративного рівня для збору та обробки щомісячних товарних звітів із кількох магазинів. Він автоматизує рутинну роботу адміністратора, скорочує помилки при підрахунках і забезпечує прозорий контроль над звітами, цінами та історією змін.

## Про проєкт

`EasyMourningReport` призначений для компаній, де кілька торгових точок регулярно подають звіти про продажі. Замість ручного ведення Excel-таблиць або розкиданих форм, система централізує весь процес в одному веб-додатку.

Адміністратор:
- веде каталог товарів та цін;
- додає магазини та користувачів;
- контролює звіти по місяцях;
- переглядає журнал дій та історію змін;
- керує публічним тунелем прямо в панелі налаштувань.

Магазин:
- входить у систему;
- обирає місяць;
- вносить лише кількості товарів;
- зберігає чернетку або надсилає звіт;
- отримує автоматично підраховані суми.

## Чому це корисно

- зменшує ручний ввід даних;
- знижує ризик помилок у підрахунках;
- спрощує контроль за кількома магазинами;
- зберігає повну історію зміни цін у розрізі кожного місяця;
- плавні анімації відкриття та закриття полів редагування (зміна ціни, додавання товару/магазину, сповіщення);
- автоматичне створення постійного сховища на хості (`./data`, `./backups`, `./backups-mirror`) як на Linux, так і на Windows;
- розгортається однією командою через Docker Compose без ручного налаштування.

## Основні можливості

- **Сучасний клієнтський SPA-інтерфейс**: React 18, TypeScript, Tailwind CSS, Radix UI та TanStack Query без жодних сторонніх CDN-залежностей на етапі виконання.
- **Плавні анімації та преміальний UI**:
  - Компонент `AnimatedCollapse` забезпечує плавні 60fps-анімації появи та зникнення полів (зміна ціни, форма створення товару чи магазину, банери сповіщень).
  - Покращена глибина кольорів, напівпрозорі панелі, фокусні кільця з підсвічуванням і тактильні мікровзаємодії без зміни структури та макетів.
- **Окремі оптимізовані робочі простори**:
  - *Для магазину*: зручний адаптивний екран (`/report`) з великими кнопками крокового введення (stepper), режимами Desktop/Cards, підтримкою швидкого введення на телефоні, збереженням чернеток та підтвердженням відправки.
  - *Для адміністратора*: адаптивна панель (`/admin/*`) — бічна панель на десктопі, нижня панель на мобільних пристроях.
- **Повна підтримка офлайн-роботи (PWA)**: сервіс-воркер кешує ресурси застосунку, а чернетки звітів зберігаються локально в браузері та автоматично синхронізуються при відновленні з'єднання.
- **Управління товарами та цінами**: швидкий пошук, плавне розгортання редактора ціни з історією за поточний місяць, архівування та відновлення.
- **Масовий імпорт з Excel (.xlsx)**: колонка A — назва, колонка B — ціна.
- **Експорт зведеного звіту в Excel (.xlsx)**: пряме скачування файлу зведення за вибраний місяць.
- **Керування магазинами та обліковими записами**: створення, редагування, скидання паролів, архівування.
- **Щомісячні звіти та блокування**: перегляд поданих звітів, детальний перегляд із можливістю розблокування/блокування.
- **Журнал аудиту**: детальний аудит дій у системі з фільтрацією за типами подій та пошуком.
- **Керування публічним тунелем**: статус тунелю Cloudflare, перемикач автозапуску та запуск/зупинка безпосередньо з панелі налаштувань.
- **Надійне збереження даних**: PostgreSQL 16 у зовнішньому томі `easymourningreport_pgdata`, `./data` (секрети, стан тунелю), `./backups` (SQL-знімки) та `./backups-mirror` (незалежне зеркало) монтуються з хост-пристрою.
- **Безпека**: збереження паролів через PBKDF2-хешування із сіллю, захист сесій та перевірка походження запитів.

## Технологічний стек

- **Бекенд**:
  - Python 3.11+
  - FastAPI & Starlette
  - Uvicorn (із проксі-заголовками та пересиланням IP)
  - SQLModel (SQLAlchemy 2) & PostgreSQL 16 через `psycopg`
  - uv (керування залежностями, PEP 621, `uv.lock`)
  - openpyxl (генерація та парсинг Excel)
- **Фронтенд**:
  - React 18 & TypeScript (суворий режим)
  - Vite 6
  - Tailwind CSS 3
  - Radix UI (доступні модальні вікна та примітиви)
  - TanStack Query v5 (серверний стан, кешування та оптимістичні оновлення)
  - React Router v6 (маршрутизація з code-splitting)
  - Lucide React (іконки)
  - Самостійний шрифт **Onest** (`@fontsource/onest`) без зовнішніх запитів до Google Fonts чи CDN
- **Інфраструктура**:
  - Docker & Docker Compose (багатоетапна збірка: Stage 1 Node.js build → Stage 2 Python builder → Stage 3 Minimal runtime)
  - Автоматичне постійне сховище на хост-пристрої (`./data`, `./backups`, `./backups-mirror`)
  - Cloudflare Tunnel (TryCloudflare Quick Tunnel або власний іменований тунель)

## Структура проєкту

```text
EasyMourningReport/
├── src/
│   ├── backend/                 # FastAPI-бекенд (модульний моноліт)
│   │   ├── app/
│   │   │   ├── core/            # БД, безпека, backup, PWA, валідація, entrypoint
│   │   │   ├── features/        # Вертикальні зрізи: auth, products, stores, reports, audit, tunnel
│   │   │   ├── main.py          # Композиційний корінь FastAPI
│   │   │   └── __main__.py      # Єдина точка входу: python -m app
│   │   ├── tests/               # Юніт, інтеграційні та E2E тести pytest
│   │   └── scripts/             # Допоміжні скрипти (генерація OpenAPI)
│   └── frontend/                # React SPA (React, TypeScript, Tailwind)
│       ├── public/              # PWA manifest, service worker, іконки
│       └── src/
│           ├── app/             # App shell, providers, routing
│           ├── features/        # auth, reports, audit, settings
│           └── shared/          # api, components, context, i18n, lib, test
├── docs/                        # Документація проєкту
│   ├── API.md                   # Специфікація REST API
│   ├── DESIGN.md                # Дизайн-система та специфікація інтерфейсу
│   ├── PROJECT.md               # Архітектура та контракти
│   ├── TESTING.md               # Архітектура тестового комплексу
│   ├── TEST_REPORT.md           # Результати виконання тестів
│   ├── OPERATIONS.ru.md         # Резервні копії, відновлення, аварії
│   └── archive/                 # Історичні плани SPA-міграції
├── .github/workflows/           # CI: uv, тести, фронтенд та Docker
├── docker/
│   ├── Dockerfile               # Багатоетапна збірка
│   └── ops/                     # init.sh та backup.sh для хоста
├── compose.yaml                 # App + PostgreSQL 16, external volume і backup mirror
├── pyproject.toml               # PEP 621 + hatchling (src-layout)
└── uv.lock                      # Зафіксований граф залежностей uv
```

## Розгортання через Docker Compose (Рекомендовано)

Застосунок повністю оптимізовано для роботи «з коробки» на **Linux** та **Windows 11** (як із рушієм **WSL2**, так і **Hyper-V**).

### Запуск в один крок

```bash
cp .env.example .env
./docker/ops/init.sh
```

`init.sh` створює зовнішній том PostgreSQL, каталоги резервних копій і запускає Compose. Звичайний `docker compose up -d --build` теж працює, якщо том `PGDATA_VOLUME` уже існує.

`docker compose up` піднімає обидва сервіси: PostgreSQL (`db`) і застосунок (`app`). Якщо `db` уже запущений, Compose використовує наявний контейнер, а не створює дубль. `docker compose build` лише збирає образ, а `docker run` не підключає мережу Compose, `.env`, томи та PostgreSQL — для запуску використовуйте `docker compose up`.

### Зупинка та graceful shutdown

- `docker compose up` (у foreground): `Ctrl+C` надсилає SIGINT, Compose передає застосунку SIGTERM. Uvicorn перестає приймати нові запити, завершує поточні, зупиняє тунель і backup-цикл, створює фінальну SQL-копію та закриває пул підключень. Потім зупиняється PostgreSQL. На це виділено до 60 секунд (`stop_grace_period`).
- `docker compose up -d` або `docker compose logs -f`: `Ctrl+C` зупиняє лише перегляд логів, контейнери продовжують працювати. Для штатної зупинки використовуйте `docker compose stop` (контейнери зберігаються) або `docker compose down` (контейнери й мережа видаляються, зовнішній том і дані зберігаються).
- Ніколи не використовуйте `docker compose down -v`: це видалить том PostgreSQL.

Усе налаштовується автоматично:
1. **Постійне сховище (Persistent Storage)**:
   - Застосунок монтує теки хоста `${DATA_PATH:-./data}` (`/app/data`), `${BACKUPS_PATH:-./backups}` (`/app/backups`) та `${BACKUPS_MIRROR_PATH:-./backups-mirror}` (`/app/backups-mirror`).
   - На Windows 11 права доступу до томів обробляються стійко: підтримуються файлові системи NTFS/virtiofs/DrvFs без помилок `chmod`.
   - PostgreSQL зберігає дані у зовнішньому томі `${PGDATA_VOLUME:-easymourningreport_pgdata}`. Це захищає від `docker compose down -v`, але не від видалення тома або диска, тому SQL-бекапи обов’язкові.
2. **Мережевий доступ (Network Access)**:
   - Порт зв'язується через `0.0.0.0:8000:8000`, що забезпечує прямий доступ як з хоста Windows 11 (`http://localhost:8000`), так і з інших пристроїв локальної мережі магазину (`http://<ip-адреса-хоста>:8000`).
3. **Вбудований Cloudflare Tunnel (Internal Tunnel)**:
   - Більше немає потреби в окремому контейнері-сайдкарі: бінарний файл `cloudflared` інтегровано безпосередньо в контейнер застосунку.
   - Стан тунелю та адреса публічного доступу відображаються в логах `docker compose logs app` або в панелі адміністратора на вкладці **«Налаштування» → «Публічний доступ»**.

### Налаштування середовища (.env)

За потреби створіть `.env` файл із шаблону:
```bash
cp .env.example .env
```

Доступні змінні:
- `PORT`: порт на хості (за замовчуванням `8000`, прив'язка до `0.0.0.0`).
- `DATA_PATH`: шлях до постійного сховища на хості (за замовчуванням `./data`). На Windows 11 використовуйте відносний шлях (`./data`) або прямі слеші (`C:/EasyMourningReport/data`).
- `BACKUPS_PATH`: шлях до основних SQL-бекапів на хості (за замовчуванням `./backups`).
- `BACKUPS_MIRROR_PATH`: шлях до незалежного зеркала бекапів (за замовчуванням `./backups-mirror`).
- `PGDATA_VOLUME`: ім’я зовнішнього Docker volume для PostgreSQL (за замовчуванням `easymourningreport_pgdata`).
- `BACKUP_KEEP`, `BACKUP_EVERY_MIN`: кількість знімків і період автоматичного backup.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`: параметри вбудованого PostgreSQL.
- `DATABASE_URL`: повний рядок підключення (наприклад, `postgresql+psycopg://user:pass@host:5432/db`); перекриває `POSTGRES_*`.
- `ADMIN_PASSWORD`: фіксований пароль адміністратора на перший запуск.
- `PUBLIC_URL`: публічний домен або адреса реверс-проксі (наприклад, `https://report.example.com`).
- `TUNNEL_ENABLED`: автоматичний запуск тунелю при старті застосунку (`true`/`false`).
- `TUNNEL_TOKEN`: токен власного іменованого Cloudflare тунелю (за відсутності запускається автоматичний Quick Tunnel).
- `DEMO`: встановити `1` для заповнення демо-даними.

---

## Локальна розробка

### 1. Бекенд (Python & FastAPI)

Встановлення залежностей та запуск PostgreSQL (для локальної розробки):
```bash
uv sync
docker compose up -d db
```

Запуск сервера розробки:
```bash
uv run python -m app
```
або напряму через Uvicorn з кореня репозиторію:
```bash
uv run uvicorn app.main:app --reload
```

Запуск бекенд-тестів (кеш і bytecode вимкнено):
```bash
PYTHONDONTWRITEBYTECODE=1 uv run pytest
```

### 2. Фронтенд (React, TypeScript & Vite)

Усі файли клієнтського застосунку знаходяться у директорії `src/frontend/`.

Встановлення залежностей:
```bash
cd src/frontend
npm install
```

Запуск сервера розробки Vite з проксіюванням API на бекенд (`http://localhost:8000`):
```bash
npm run dev
```

Перевірка лінтером та типами:
```bash
npm run lint
npm run typecheck
```

Запуск юніт-тестів (Vitest):
```bash
npm test -- --run
```

Збірка у продакшн (результат записується в `src/backend/app/static/app/`):
```bash
npm run build
```

Оновлення TypeScript-типів API з OpenAPI-схеми бекенда:
```bash
npm run gen:api
```

---

## Безпека та резервні копії

- Паролі зберігаються у вигляді PBKDF2-хешів із випадковою сіллю.
- Адміністративний пароль генерується автоматично при першому запуску, якщо не задано `ADMIN_PASSWORD`.
- Резервні копії бази даних автоматично створюються під час запуску, зупинки та щогодини при активності (зберігаються у `./backups` і `./backups-mirror` на хості).
- Повний протокол backup/restore та дій під час аварій: [`docs/OPERATIONS.ru.md`](docs/OPERATIONS.ru.md).
- Секретний ключ сесії генерується автоматично у `./data/secret.key` або задається через `SECRET_KEY`.

## Ліцензія

Усі права збережено автором.

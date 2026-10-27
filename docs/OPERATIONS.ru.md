# Эксплуатация, резервное копирование и восстановление

Документ описывает рабочий контур EasyMourningReport на одном хосте Docker Compose с PostgreSQL 16.

## 1. Неподменяемые правила

1. Не выполнять `docker compose down -v`, `docker volume rm`, `docker system prune --volumes` и не удалять тома через Docker Desktop, пока не проверена резервная копия.
2. Не запускать «чистый» контейнер приложения поверх пустого тома. Сначала восстановить базу, только потом запускать `app`.
3. Перед обновлением, миграцией, переносом или восстановлением делать внеплановый backup.
4. Хранить резервные копии минимум в двух местах: основной каталог и зеркало на другом физическом диске/сетевом хранилище.
5. Проверять восстановление не реже одного раза в месяц. Непроверенная копия не считается резервной копией.
6. `SECRET_KEY`, `POSTGRES_PASSWORD` и `.env` хранить отдельно от репозитория. Без них восстановление данных возможно, но пользовательские сессии и доступ к БД потребуют перенастройки.

## 2. Где лежат данные

| Данные | Расположение по умолчанию | Комментарий |
|---|---|---|
| База PostgreSQL | внешний Docker volume `easymourningreport_pgdata` | Переживает `docker compose down`, но не удаление тома |
| Секреты и состояние туннеля | `${DATA_PATH:-./data}` → `/app/data` | Bind mount на хосте |
| SQL-копии | `${BACKUPS_PATH:-./backups}` → `/app/backups` | Основное хранилище |
| Зеркало SQL-копий | `${BACKUPS_MIRROR_PATH:-./backups-mirror}` → `/app/backups-mirror` | Желательно другой диск |
| Конфигурация | `.env` | Не коммитить в git |

Том задаётся переменной `PGDATA_VOLUME`. Значение по умолчанию — `easymourningreport_pgdata`. В `compose.yaml` том объявлен как `external: true`, поэтому Compose не удаляет его при удалении проекта.

Внутри PostgreSQL используется подкаталог `PGDATA=/var/lib/postgresql/data/pgdata`. Это нормально: внешний том смонтирован в `/var/lib/postgresql/data`.

## 3. Первый запуск

```bash
cp .env.example .env
# Отредактируйте .env: пароль БД, SECRET_KEY, пути, зеркало backup
./docker/ops/init.sh
docker compose ps
docker compose logs -f app
```

`docker/ops/init.sh`:

- создаёт внешний том, если его ещё нет;
- создаёт каталоги `data`, `backups`, `backups-mirror`;
- запускает `db` и `app` через `docker compose up -d --build`.

PostgreSQL не нужно запускать отдельно: `db` объявлен в `compose.yaml`, а `app` ждёт его healthcheck. Если контейнер `mourningreport-db` уже работает, Compose использует его повторно. `docker compose build` только собирает образ и ничего не запускает; `docker run` обходит сеть Compose и не видит `db`.

Проверка:

```bash
curl -fsS http://127.0.0.1:8000/ >/dev/null && echo OK
docker compose exec -T db pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-mourningreport}"
```

При первом запуске приложение создаст администратора. Пароль выводится в `docker compose logs app` или задаётся через `ADMIN_PASSWORD`.

## 4. Автоматические копии

Приложение делает SQL-снимок:

- при старте;
- при штатной остановке;
- каждые `BACKUP_EVERY_MIN` минут (по умолчанию 60);
- по кнопке скачивания в панели администратора.

Для каждого файла создаётся `.sha256` с контрольной суммой. Основной каталог и зеркало обрезаются до `BACKUP_KEEP` последних снимков (по умолчанию 100).

Недоступность зеркала не отменяет основной backup. Ошибка пишется в лог приложения. Это предупреждение нужно разбирать: зеркало без свежих копий не защищает от отказа основного диска.

Дополнительно настроить независимый cron на хосте:

```cron
17 2 * * * cd /opt/EasyMourningReport && ./docker/ops/backup.sh >> ./backups/host-backup.log 2>&1
```

`docker/ops/backup.sh` использует `pg_dump` внутри контейнера `db`, не зависит от приложения и умеет работать при остановленном `app`. Перед запуском скрипт читает `.env`.

## 5. Ручной backup

```bash
cd /opt/EasyMourningReport
./docker/ops/backup.sh
```

Проверка целостности:

```bash
cd backups
sha256sum -c reports-YYYYMMDD-HHMMSS-host.sql.sha256
```

Проверка, что дамп не пустой и содержит схему:

```bash
grep -E 'CREATE TABLE|COPY |INSERT INTO' reports-YYYYMMDD-HHMMSS-host.sql | head
```

Скопировать `.sql` и `.sha256` на внешний носитель. Копировать только `.sql` без checksum недостаточно для управляемого восстановления.

## 6. Полное восстановление

Восстановление выполняйте в окно обслуживания. Приложение должно быть остановлено: иначе оно продолжит писать в базу.

### 6.1. Подготовка

```bash
cd /opt/EasyMourningReport
export STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "backups/pre-restore-$STAMP"
cp .env "backups/pre-restore-$STAMP/.env"
./docker/ops/backup.sh
cp backups/reports-*-host.sql "backups/pre-restore-$STAMP/" 2>/dev/null || true
```

Если `backup.sh` не работает, сделать аварийный снимок вручную:

```bash
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" db \
  pg_dump -h 127.0.0.1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-mourningreport}" \
  --no-owner --no-acl > "backups/pre-restore-$STAMP/manual.sql"
```

### 6.2. Выбор копии и проверка checksum

```bash
cd /opt/EasyMourningReport/backups
sha256sum -c reports-YYYYMMDD-HHMMSS-host.sql.sha256
```

Если checksum не совпал, файл повреждён. Использовать другую копию, в том числе из зеркала.

### 6.3. Остановка приложения и graceful shutdown

```bash
cd /opt/EasyMourningReport
docker compose stop app
docker compose ps
```

`docker compose stop app` отправляет контейнеру SIGTERM и ждёт до 60 секунд. За это время приложение:

1. перестаёт принимать новые HTTP-запросы и завершает текущие;
2. останавливает Cloudflare Tunnel;
3. отменяет периодический backup-цикл;
4. создаёт финальную SQL-копию;
5. закрывает пул подключений к PostgreSQL.

`db` должен остаться запущенным. Если он остановлен, поднимите его снова:

```bash
docker compose up -d db
```

Если запустить `docker compose up` в foreground, `Ctrl+C` инициирует тот же штатный сценарий: Compose передаёт SIGTERM приложению, затем PostgreSQL. В режиме `docker compose up -d` или `docker compose logs -f` `Ctrl+C` останавливает только вывод логов. Для полной остановки используйте `docker compose down` (контейнеры и сеть удаляются, внешний том сохраняется). Не используйте `docker compose down -v`.

### 6.4. Пересоздание базы

Значения ниже соответствуют `.env`. Для других `POSTGRES_USER`/`POSTGRES_DB` подставьте свои.

```bash
DB_NAME="${POSTGRES_DB:-mourningreport}"
DB_USER="${POSTGRES_USER:-postgres}"

docker compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"

docker compose exec -T db dropdb -U "$DB_USER" --if-exists "$DB_NAME"
docker compose exec -T db createdb -U "$DB_USER" -O "$DB_USER" "$DB_NAME"
```

### 6.5. Загрузка дампа

```bash
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  < "backups/reports-YYYYMMDD-HHMMSS-host.sql"
```

Если дамп создан приложением и содержит `--no-owner`, ошибки владельцев не ожидаются. При ошибке `psql` остановится из-за `ON_ERROR_STOP=1`; не игнорируйте её.

### 6.6. Запуск и проверка

```bash
docker compose start app
docker compose ps
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:8000/ >/dev/null && echo OK
```

Проверить вручную:

- вход администратора;
- список магазинов и товаров;
- последний отправленный отчёт;
- журнал аудита;
- скачивание backup.

### 6.7. Откат восстановления

Если после восстановления приложение не работает:

```bash
docker compose stop app
docker compose exec -T db psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"
docker compose exec -T db dropdb -U "$DB_USER" --if-exists "$DB_NAME"
docker compose exec -T db createdb -U "$DB_USER" -O "$DB_USER" "$DB_NAME"
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  < "backups/pre-restore-$STAMP/manual.sql"
docker compose start app
```

## 7. Частичное восстановление

Полный SQL-дамп не предназначен для выборочной замены одной таблицы «на живую». Безопасный порядок:

1. Поднять отдельную временную базу, например `mourningreport_restore`.
2. Загрузить дамп в неё.
3. Извлечь нужные строки/таблицы через `psql` или `pg_dump -t`.
4. Перенести данные в рабочую базу скриптом с проверкой ключей.
5. Сделать backup рабочей базы до переноса и после него.

Не выполнять `DROP TABLE` в рабочей базе без предварительного backup и понимания внешних ключей.

## 8. Защита тома PostgreSQL

Внешний том защищает от `docker compose down -v`, но **не** защищает от:

- `docker volume rm easymourningreport_pgdata`;
- `docker system prune --volumes`;
- удаления через Docker Desktop → Volumes / Clean data;
- переустановки Docker с очисткой данных;
- потери диска;
- ошибки администратора внутри PostgreSQL.

Поэтому основной контур — это не том, а регулярные проверенные SQL-копии на двух носителях.

Перед любыми работами с Docker проверить:

```bash
docker volume inspect easymourningreport_pgdata
docker compose config | sed -n '/volumes:/,$p'
```

## 9. Обновление приложения

```bash
cd /opt/EasyMourningReport
./docker/ops/backup.sh
git pull
docker compose build --pull app
docker compose up -d
docker compose logs --tail=100 app
```

Перед обновлением схемы приложение создаёт backup с тегом `before-migrate`. Alembic пока не подключён: `bootstrap.migrate()` добавляет новые таблицы и отдельные колонки, но не удаляет и не переименовывает данные. Для несовместимых изменений схемы требуется отдельный план миграции.

## 10. Типовые аварии

### 10.1. Пропал или повреждён том

1. Не запускать `app`.
2. Создать пустой внешний том: `./docker/ops/init.sh` (или `docker volume create easymourningreport_pgdata`).
3. Поднять только `db`: `docker compose up -d db`.
4. Восстановить последнюю проверенную SQL-копию по разделу 6.
5. Только после успешного восстановления запустить `app`.

### 10.2. Случайно удалены данные в приложении

1. Немедленно остановить `app`: `docker compose stop app`.
2. Не запускать повторно backup-цикл до выбора копии.
3. Взять копию до момента удаления (проверить несколько последних файлов).
4. Выполнить полное восстановление.
5. После инцидента проверить права пользователей и журнал аудита.

### 10.3. Потерян хост целиком

Нужны:

- `.env` с теми же `SECRET_KEY`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB`;
- последний `.sql` и `.sha256`;
- каталог `data` (для состояния туннеля) — по возможности;
- исходный код/образ приложения.

Развернуть проект, создать том, поднять `db`, восстановить дамп, затем запустить `app`.

## 11. Ежемесячная проверка

- [ ] `docker compose ps` — `db` и `app` healthy/running.
- [ ] В `backups` есть свежие `.sql` и `.sha256`.
- [ ] В `backups-mirror` есть те же имена файлов.
- [ ] `sha256sum -c` проходит для основной и зеркальной копии.
- [ ] Выполнено тестовое восстановление во временную базу.
- [ ] Сделан вход администратора и проверен один отчёт.
- [ ] Свободное место на диске не меньше двух полных объёмов базы.
- [ ] `.env` и внешняя копия доступны ответственным лицам.

## 12. Быстрые команды

```bash
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 db
docker compose stop app
docker compose start app
docker compose up -d --build
docker compose down
./docker/ops/backup.sh
sha256sum -c backups/reports-YYYYMMDD-HHMMSS-host.sql.sha256
```

Не использовать `docker compose down -v` как способ «перезапустить всё».

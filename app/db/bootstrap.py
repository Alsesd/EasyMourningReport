"""Database initialization, demo seeding, and schema migration."""
import os
import secrets

from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.core.security import hash_pw
from app.db.backup import backup_db
from app.db.base import Base
from app.db.models.product import Product, ProductPrice
from app.db.models.store import Store
from app.db.models.user import User
from app.db.session import SessionLocal, engine
from app.services.pricing import BASE_PERIOD, dedupe_logins


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        admin_pw = os.getenv("ADMIN_PASSWORD")
        if os.getenv("CLOUDFLARE_WORKERS") == "1" and not admin_pw:
            raise RuntimeError(
                "Set the ADMIN_PASSWORD Worker secret before first deployment."
            )
        admin_pw = admin_pw or secrets.token_urlsafe(9)
        db.add(User(login="admin", password_hash=hash_pw(admin_pw), role="admin"))
        if os.getenv("CLOUDFLARE_WORKERS") != "1":
            print(
                f"\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '{admin_pw}'. "
                "Змініть його на сторінці «Налаштування». ***\n",
                flush=True,
            )
        try:
            if not os.getenv("DEMO"):
                db.commit()
                return
            demo = [
                Product(name="Яблука, кг", price_cents=250),
                Product(name="Хліб", price_cents=120),
                Product(name="Молоко, 1 л", price_cents=95),
            ]
            db.add_all(demo)
            db.flush()
            db.add_all(
                ProductPrice(product_id=p.id, period=BASE_PERIOD, price_cents=p.price_cents)
                for p in demo
            )
            for n in (1, 2):
                store = Store(name=f"Магазин {n}")
                db.add(store)
                db.flush()
                db.add(
                    User(
                        login=f"store{n}",
                        password_hash=hash_pw(f"store{n}"),
                        role="store",
                        store_id=store.id,
                    )
                )
            db.commit()
        except IntegrityError:
            # Concurrent serverless cold starts may both observe an empty DB.
            db.rollback()
            if db.scalar(select(User.id).limit(1)):
                return
            raise


def _migrate_sqlite() -> None:
    """Preserve the legacy SQLite migration path used by desktop deployments."""
    def columns(connection, table: str) -> list[str]:
        return [row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")]

    with engine.connect() as connection:
        tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        old_db = "products" in tables
        needs = old_db and (
            "product_prices" not in tables
            or "archived" not in columns(connection, "products")
            or "archived" not in columns(connection, "stores")
            or "status" not in columns(connection, "reports")
        )
        logins = (
            [(row[0], row[1]) for row in connection.exec_driver_sql("SELECT id, login FROM users")]
            if "users" in tables
            else []
        )
    if needs:
        backup_db("before-migrate")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        if "status" not in columns(connection, "reports"):
            connection.exec_driver_sql(
                "ALTER TABLE reports ADD COLUMN status VARCHAR NOT NULL DEFAULT 'draft'"
            )
        for table in ("products", "stores"):
            if "archived" not in columns(connection, table):
                connection.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"
                )
        connection.exec_driver_sql(
            "INSERT INTO product_prices (product_id, period, price_cents) "
            f"SELECT id, '{BASE_PERIOD}', price_cents FROM products "
            "WHERE id NOT IN (SELECT product_id FROM product_prices)"
        )
        current = dict(logins)
        renames = {
            uid: new
            for uid, new in dedupe_logins(logins).items()
            if new != current[uid]
        }
        for uid in renames:
            connection.exec_driver_sql(
                "UPDATE users SET login = ? WHERE id = ?", (f"~migrating~{uid}", uid)
            )
        for uid, new in renames.items():
            connection.exec_driver_sql(
                "UPDATE users SET login = ? WHERE id = ?", (new, uid)
            )


def _migrate_remote() -> None:
    """Create/upgrade a hosted SQL database without SQLite-only PRAGMA statements."""
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if not tables:
        return
    with engine.begin() as connection:
        for table, column, definition in (
            ("reports", "status", "VARCHAR NOT NULL DEFAULT 'draft'"),
            ("products", "archived", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("stores", "archived", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ):
            if table in tables and column not in {
                item["name"] for item in inspect(connection).get_columns(table)
            }:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
        if {"products", "product_prices"}.issubset(tables):
            connection.execute(
                text(
                    "INSERT INTO product_prices (product_id, period, price_cents) "
                    "SELECT p.id, :period, p.price_cents FROM products p "
                    "WHERE NOT EXISTS (SELECT 1 FROM product_prices pp "
                    "WHERE pp.product_id = p.id)"
                ),
                {"period": BASE_PERIOD},
            )
        if "users" in tables:
            rows = connection.execute(text("SELECT id, login FROM users ORDER BY id")).all()
            current = [(row[0], row[1]) for row in rows]
            current_by_id = dict(current)
            renames = {
                uid: new
                for uid, new in dedupe_logins(current).items()
                if current_by_id[uid] != new
            }
            # Avoid transient unique-key collisions during case/whitespace normalization.
            for uid in renames:
                connection.execute(
                    text("UPDATE users SET login = :login WHERE id = :id"),
                    {"login": f"~migrating~{uid}", "id": uid},
                )
            for uid, login in renames.items():
                connection.execute(
                    text("UPDATE users SET login = :login WHERE id = :id"),
                    {"login": login, "id": uid},
                )


def migrate() -> None:
    """Initialize the schema and apply compatibility migrations for the selected database."""
    if engine.dialect.name == "sqlite":
        _migrate_sqlite()
    else:
        _migrate_remote()

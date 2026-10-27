"""Database initialization, demo seeding, and PostgreSQL schema synchronization."""

import os
import secrets

from sqlalchemy import inspect, text
from sqlmodel import select

from app.core.backup import backup_db
from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_pw
from app.features.auth.models import User
from app.features.auth.permissions import ALL_PERMISSIONS, encode_permissions
from app.features.auth.service import dedupe_logins
from app.features.products.models import Product, ProductPrice
from app.features.products.service import BASE_PERIOD
from app.features.stores.models import Store


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        admin_pw = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        db.add(
            User(
                login="admin",
                name="Адміністратор",
                password_hash=hash_pw(admin_pw),
                role="admin",
                permissions=encode_permissions(ALL_PERMISSIONS),
            )
        )
        print(
            f"\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '{admin_pw}'. "
            "Змініть його на сторінці «Налаштування». ***\n",
            flush=True,
        )
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
            s = Store(name=f"Магазин {n}")
            db.add(s)
            db.flush()
            db.add(
                User(
                    login=f"store{n}",
                    name=f"Магазин {n}",
                    password_hash=hash_pw(f"store{n}"),
                    role="store",
                    permissions=encode_permissions(["sales_report"]),
                    store_id=s.id,
                )
            )
        db.commit()


def migrate() -> None:
    """Ensure database schema is created and upgraded using dialect-agnostic metadata inspection."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    def get_columns(table_name: str) -> set[str]:
        if table_name not in tables:
            return set()
        return {col["name"] for col in inspector.get_columns(table_name)}

    old_db = "products" in tables
    needs = old_db and (
        "product_prices" not in tables
        or "archived" not in get_columns("products")
        or "archived" not in get_columns("stores")
        or "status" not in get_columns("reports")
        or (
            "users" in tables
            and (
                "name" not in get_columns("users")
                or "permissions" not in get_columns("users")
            )
        )
    )

    if needs:
        backup_db("before-migrate")

    Base.metadata.create_all(engine)

    # Re-inspect tables and columns after table creation
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    with engine.begin() as c:
        reports_cols = {col["name"] for col in inspector.get_columns("reports")} if "reports" in tables else set()
        if "reports" in tables and "status" not in reports_cols:
            c.execute(
                text("ALTER TABLE reports ADD COLUMN status VARCHAR NOT NULL DEFAULT 'draft'")
            )
        for table in ("products", "stores"):
            tbl_cols = {col["name"] for col in inspector.get_columns(table)} if table in tables else set()
            if table in tables and "archived" not in tbl_cols:
                c.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE")
                )
        if "products" in tables and "product_prices" in tables:
            c.execute(
                text(
                    "INSERT INTO product_prices (product_id, period, price_cents) "
                    f"SELECT id, '{BASE_PERIOD}', price_cents FROM products "
                    "WHERE id NOT IN (SELECT product_id FROM product_prices)"
                )
            )

        if "users" in tables:
            users_cols = {col["name"] for col in inspector.get_columns("users")}
            if "name" not in users_cols:
                c.execute(
                    text("ALTER TABLE users ADD COLUMN name VARCHAR NOT NULL DEFAULT ''")
                )
            if "permissions" not in users_cols:
                c.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN permissions VARCHAR NOT NULL DEFAULT '[]'"
                    )
                )
            c.execute(
                text("UPDATE users SET name = TRIM(login) WHERE name IS NULL OR name = ''")
            )
            c.execute(
                text(
                    'UPDATE users SET permissions = \'["sales_report"]\' '
                    "WHERE role = 'store' AND (permissions IS NULL OR permissions IN ('', '[]'))"
                )
            )
            logins = [(r[0], r[1]) for r in c.execute(text("SELECT id, login FROM users"))]
            current = dict(logins)
            renames = {
                uid: new
                for uid, new in dedupe_logins(logins).items()
                if new != current[uid]
            }
            for uid in renames:
                c.execute(
                    text("UPDATE users SET login = :login WHERE id = :id"),
                    {"login": f"~migrating~{uid}", "id": uid},
                )
            for uid, new in renames.items():
                c.execute(
                    text("UPDATE users SET login = :login WHERE id = :id"),
                    {"login": new, "id": uid},
                )

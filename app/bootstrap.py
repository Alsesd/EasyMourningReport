"""Database initialization, demo seeding, and legacy-schema migration."""

import os
import secrets

from sqlalchemy import select

from .backup import backup_db
from .models import Base, Product, ProductPrice, SessionLocal, Store, User, engine
from .pricing import BASE_PERIOD, dedupe_logins
from .security import hash_pw


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        admin_pw = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        db.add(User(login="admin", password_hash=hash_pw(admin_pw), role="admin"))
        print(f"\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '{admin_pw}'. Змініть його на сторінці «Налаштування». ***\n", flush=True)
        if not os.getenv("DEMO"):
            db.commit()
            return
        demo = [Product(name="Яблука, кг", price_cents=250), Product(name="Хліб", price_cents=120),
                Product(name="Молоко, 1 л", price_cents=95)]
        db.add_all(demo)
        db.flush()
        db.add_all(ProductPrice(product_id=p.id, period=BASE_PERIOD, price_cents=p.price_cents) for p in demo)
        for n in (1, 2):
            s = Store(name=f"Магазин {n}")
            db.add(s)
            db.flush()
            db.add(User(login=f"store{n}", password_hash=hash_pw(f"store{n}"), role="store", store_id=s.id))
        db.commit()


def migrate() -> None:
    """Bring a database created by an older version up to date. A backup is taken first if anything has to change."""
    def columns(c, table: str) -> list[str]:
        return [r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")]

    with engine.connect() as c:
        tables = {r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        old_db = "products" in tables
        needs = old_db and ("product_prices" not in tables or "archived" not in columns(c, "products")
                            or "archived" not in columns(c, "stores") or "status" not in columns(c, "reports"))
        logins = [(r[0], r[1]) for r in c.exec_driver_sql("SELECT id, login FROM users")] if "users" in tables else []
    if needs:
        backup_db("before-migrate")
    Base.metadata.create_all(engine)
    with engine.begin() as c:
        if "status" not in columns(c, "reports"):
            c.exec_driver_sql("ALTER TABLE reports ADD COLUMN status VARCHAR NOT NULL DEFAULT 'draft'")
        for table in ("products", "stores"):
            if "archived" not in columns(c, table):
                c.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0")
        # every product needs a starting price record
        c.exec_driver_sql("INSERT INTO product_prices (product_id, period, price_cents) "
                          f"SELECT id, '{BASE_PERIOD}', price_cents FROM products "
                          "WHERE id NOT IN (SELECT product_id FROM product_prices)")
        # logins are case-insensitive: store them trimmed and lower-cased, and keep them unique
        current = dict(logins)
        renames = {uid: new for uid, new in dedupe_logins(logins).items() if new != current[uid]}
        for uid in renames:  # two steps, so that two logins swapping names never collide on the UNIQUE constraint
            c.exec_driver_sql("UPDATE users SET login = ? WHERE id = ?", (f"~migrating~{uid}", uid))
        for uid, new in renames.items():
            c.exec_driver_sql("UPDATE users SET login = ? WHERE id = ?", (new, uid))

"""Upgrade databases from the single-role era (``users.role`` = "admin" | "store", one login per store)."""

from sqlalchemy.engine import Connection
from sqlmodel import Session

from app.core.modules import Migration
from app.core.text import dedupe_logins
from app.db.migrations import columns, table_names
from app.platform.accounts.models import Role, RolePermission, UserRole
from app.platform.accounts.permissions import PLATFORM_ADMIN, STORE


def _normalise_logins(conn: Connection) -> None:
    """Logins are case-insensitive: store them trimmed and lower-cased, and keep them unique."""
    logins = [(r[0], r[1]) for r in conn.exec_driver_sql("SELECT id, login FROM users")]
    current = dict(logins)
    renames = {uid: new for uid, new in dedupe_logins(logins).items() if new != current[uid]}
    for uid in renames:  # two steps, so that two logins swapping names never collide on UNIQUE
        conn.exec_driver_sql("UPDATE users SET login = ? WHERE id = ?", (f"~migrating~{uid}", uid))
    for uid, new in renames.items():
        conn.exec_driver_sql("UPDATE users SET login = ? WHERE id = ?", (new, uid))


def organisations_and_roles(conn: Connection) -> None:
    tables = table_names(conn)
    if "stores" in tables and "organisations" not in tables:
        if "archived" not in columns(conn, "stores"):
            conn.exec_driver_sql("ALTER TABLE stores ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0")
        # SQLite rewrites foreign keys that point at the renamed table (reports.store_id etc.).
        conn.exec_driver_sql("ALTER TABLE stores RENAME TO organisations")
        conn.exec_driver_sql("DROP INDEX IF EXISTS ix_stores_name")
        conn.exec_driver_sql("DROP INDEX IF EXISTS ix_stores_archived")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_organisations_name ON organisations (name)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_organisations_archived ON organisations (archived)")

    if "users" not in tables:
        return
    _normalise_logins(conn)
    user_columns = columns(conn, "users")
    if "full_name" not in user_columns:
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN full_name VARCHAR NOT NULL DEFAULT ''")
    if "active" not in user_columns:
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT 1")
    if "created_at" not in user_columns:
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN created_at DATETIME")
    if "store_id" in user_columns:
        conn.exec_driver_sql("DROP INDEX IF EXISTS ix_users_store_id")
        conn.exec_driver_sql("ALTER TABLE users RENAME COLUMN store_id TO organisation_id")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_users_organisation_id ON users (organisation_id)")
    if "role" not in user_columns:
        return

    for model in (Role, RolePermission, UserRole):
        model.__table__.create(conn, checkfirst=True)  # type: ignore[attr-defined]
    # Built-in roles get their modules' default permissions (e.g. "Магазин" → reports.submit).
    from app.platform.accounts.service import ensure_built_in_roles

    with Session(bind=conn) as db:
        roles = ensure_built_in_roles(db)
        db.flush()
        role_ids = {"admin": roles[PLATFORM_ADMIN].id, "store": roles[STORE].id}
    for uid, legacy_role, org_id in conn.exec_driver_sql(
        "SELECT id, role, organisation_id FROM users"
    ).fetchall():
        role_id = role_ids.get(legacy_role)
        if legacy_role == "admin":
            # Administrators become platform staff even if an old row carried a store id.
            conn.exec_driver_sql("UPDATE users SET organisation_id = NULL WHERE id = ?", (uid,))
        elif legacy_role == "store" and org_id is None:
            conn.exec_driver_sql("UPDATE users SET active = 0 WHERE id = ?", (uid,))
        if role_id:
            conn.exec_driver_sql(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", (uid, role_id)
            )
    conn.exec_driver_sql("DROP INDEX IF EXISTS ix_users_role")
    conn.exec_driver_sql("ALTER TABLE users DROP COLUMN role")


MIGRATIONS = (Migration("platform.0001_organisations_and_roles", organisations_and_roles),)

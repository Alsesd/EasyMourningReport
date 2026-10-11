"""Store repository and validation queries."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.report import Report
from app.db.models.store import Store
from app.db.models.user import User
from app.services.pricing import same_name


def store_periods(db: Session, store_id: int) -> set[str]:
    return set(db.scalars(select(Report.period).where(Report.store_id == store_id)))


def check_unique_store(
    db: Session,
    name: str,
    login: str,
    store_id: int | None = None,
    user_id: int | None = None,
) -> None:
    """Store names and logins must be unique; case and extra spaces do not count as a difference."""
    from app.core.ui import FormError

    for s in db.scalars(select(Store)):
        if s.id != store_id and same_name(s.name, name):
            raise FormError(
                f"Магазин із назвою «{s.name}» уже існує"
                + (" (в архіві)" if s.archived else "")
            )
    other = db.scalar(
        select(User).where(User.login == login, User.id != (user_id or 0))
    )
    if other:
        raise FormError(
            f"Логін «{login}» уже зайнятий. Логіни не залежать від регістру: Store1 і store1 — той самий."
        )

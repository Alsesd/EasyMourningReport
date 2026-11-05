"""Demo data (``DEMO=1`` on an empty database): three products and two stores with logins."""

from sqlmodel import Session

from app.core.security import hash_pw
from app.modules.reports.models import Product, ProductPrice
from app.modules.reports.pricing import BASE_PERIOD
from app.platform.accounts.models import Organisation, User
from app.platform.accounts.permissions import STORE
from app.platform.accounts.service import role_by_key


def seed_demo(db: Session) -> None:
    demo = [
        Product(name="Яблука, кг", price_cents=250),
        Product(name="Хліб", price_cents=120),
        Product(name="Молоко, 1 л", price_cents=95),
    ]
    db.add_all(demo)
    db.flush()
    db.add_all(
        ProductPrice(product_id=p.id, period=BASE_PERIOD, price_cents=p.price_cents) for p in demo
    )
    store_role = role_by_key(db, STORE)
    for n in (1, 2):
        org = Organisation(name=f"Магазин {n}")
        db.add(org)
        db.flush()
        user = User(login=f"store{n}", password_hash=hash_pw(f"store{n}"), organisation_id=org.id)
        user.roles = [store_role]
        db.add(user)

"""Excel import/export business logic using openpyxl."""

import io

from fastapi import HTTPException, Request
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ui import done
from app.db.models.product import Product, ProductPrice
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.services.pricing import BASE_PERIOD, norm_name


def parse_products_excel(
    payload: bytes, db: Session, user: User, request: Request
):
    """Parse products from Excel and insert them into the database."""
    from app.core.dependencies import clean_name, to_cents
    try:
        workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
        sheet = workbook.active
        parsed = []
        errors = []
        for row_number, row in enumerate(
            sheet.iter_rows(min_col=1, max_col=2, values_only=True), start=1
        ):
            raw_name, raw_price = row
            if raw_name is None and raw_price is None:
                continue
            if row_number == 1 and str(raw_name or "").strip().casefold() in {
                "name",
                "назва",
                "товар",
                "product",
            }:
                continue
            try:
                name = clean_name(str(raw_name or ""))
                if raw_price is None or isinstance(raw_price, bool):
                    raise ValueError("не вказана ціна")
                cents = to_cents(str(raw_price))
                parsed.append((row_number, name, cents))
            except Exception as exc:
                errors.append(f"рядок {row_number}: {exc}")
        workbook.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            400,
            "Не вдалося прочитати Excel-файл. Перевірте, що це коректний .xlsx.",
        )
    if errors:
        raise HTTPException(
            400, "Імпорт скасовано — виправте файл:\n" + "\n".join(errors[:20])
        )
    if not parsed:
        raise HTTPException(400, "У файлі немає товарів для імпорту")

    existing_names = {norm_name(p.name) for p in db.scalars(select(Product))}
    seen = set()
    created, skipped = [], 0
    try:
        for row_number, name, cents in parsed:
            key = norm_name(name)
            if key in existing_names or key in seen:
                skipped += 1
                continue
            p = Product(name=name, price_cents=cents)
            db.add(p)
            db.flush()
            db.add(
                ProductPrice(
                    product_id=p.id, period=BASE_PERIOD, price_cents=cents
                )
            )
            created.append((name, cents))
            seen.add(key)
        if created:
            audit(
                db,
                request,
                user.login,
                user.role,
                "масово додано товари",
                f"створено: {len(created)}, пропущено дублікатів: {skipped}",
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    if not created:
        return done(
            request,
            "/admin#products",
            f"Нових товарів не додано: усі {skipped} рядків уже існують.",
        )
    return done(
        request,
        "/admin#products",
        f"Імпорт завершено: додано {len(created)} товарів, пропущено дублікатів: {skipped}.",
    )


def generate_summary_excel(
    db: Session, period: str, submitted_only: bool = False
) -> io.BytesIO:
    """Generate Excel matrix workbook of monthly report summary."""
    from app.db.repositories.reports import build_summary
    stores, rows, store_sums, grand = build_summary(db, period, submitted_only)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Звіт"
    sheet.append(["Назва", "Ціна", "Звітована кількість", "Сума"])
    for row in rows:
        sheet.append(
            [row["name"], row["price"] / 100, row["qty"], row["sum"] / 100]
        )
    sheet.append(["Разом", None, sum(row["qty"] for row in rows), grand / 100])
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = (
        f"A1:D{sheet.max_row - 1}" if sheet.max_row > 1 else "A1:D1"
    )
    sheet.column_dimensions["A"].width = 36
    sheet.column_dimensions["B"].width = 16
    sheet.column_dimensions["C"].width = 24
    sheet.column_dimensions["D"].width = 18
    for cell in sheet["B"][1:] + sheet["D"][1:]:
        cell.number_format = "#,##0.00"
    for cell in sheet[1]:
        cell.font = cell.font.copy(bold=True)
    for cell in sheet[sheet.max_row]:
        cell.font = cell.font.copy(bold=True)
    out = io.BytesIO()
    workbook.save(out)
    out.seek(0)
    return out

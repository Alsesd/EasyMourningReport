"""Store entity."""

from sqlmodel import Field, SQLModel


class Store(SQLModel, table=True):
    __tablename__ = "stores"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    # Archived stores keep their historic reports and audit context.
    archived: bool = Field(default=False, index=True)
    # Calculation quantities are shown separately when this per-store option is enabled.
    calculation_enabled: bool = Field(
        default=False, sa_column_kwargs={"server_default": "0"}
    )

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin


class Customer(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "customers"

    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(512), default="")
    note: Mapped[str] = mapped_column(Text, default="")

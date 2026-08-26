from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin


class Device(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "devices"

    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    platform: Mapped[str] = mapped_column(String(64), default="")
    app_version: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(16), default="active")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

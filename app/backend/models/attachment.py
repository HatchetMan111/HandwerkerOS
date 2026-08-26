from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin


class Attachment(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "attachments"

    kind: Mapped[str] = mapped_column(String(16), default="photo")
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    field_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_path: Mapped[str] = mapped_column(String(512))
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    device_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

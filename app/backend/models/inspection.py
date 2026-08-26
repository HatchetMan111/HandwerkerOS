from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin

INSPECTION_STATUSES = ("draft", "in_progress", "completed", "reviewed", "archived")

ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("in_progress", "completed"),
    "in_progress": ("completed",),
    "completed": ("reviewed",),
    "reviewed": ("archived",),
    "archived": (),
}

EDITABLE_STATUSES = ("draft", "in_progress")


class Inspection(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "inspections"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    form_template_id: Mapped[str] = mapped_column(ForeignKey("form_templates.id"))
    form_version_id: Mapped[str] = mapped_column(ForeignKey("form_versions.id"))
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    device_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    defects: Mapped[list["Defect"]] = relationship(back_populates="inspection")


class Defect(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "defects"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    inspection_id: Mapped[str | None] = mapped_column(
        ForeignKey("inspections.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(4096), default="")
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    status: Mapped[str] = mapped_column(String(16), default="open")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    inspection: Mapped[Inspection | None] = relationship(back_populates="defects")

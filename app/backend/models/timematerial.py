from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin


class TimeEntry(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "time_entries"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    work_date: Mapped[str] = mapped_column(String(10), index=True)
    hours: Mapped[float] = mapped_column(Float)
    activity: Mapped[str] = mapped_column(String(2048), default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    device_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MaterialItem(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "materials"

    article_number: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(16), default="Stk")
    price_cents: Mapped[int] = mapped_column(Integer, default=0)


class MaterialUsage(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "material_usages"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    material_id: Mapped[str | None] = mapped_column(ForeignKey("materials.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(16), default="Stk")
    quantity: Mapped[float] = mapped_column(Float, default=1.0)
    price_cents: Mapped[int] = mapped_column(Integer, default=0)
    work_date: Mapped[str] = mapped_column(String(10), index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)


class Assignment(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "assignments"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    work_date: Mapped[str] = mapped_column(String(10), index=True)
    hours_planned: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="planned", index=True)


class Invoice(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "invoices"

    number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    customer_name: Mapped[str] = mapped_column(String(255), default="")
    project_name: Mapped[str] = mapped_column(String(255), default="")
    hourly_rate_cents: Mapped[int] = mapped_column(Integer, default=4500)
    tax_percent: Mapped[int] = mapped_column(Integer, default=19)
    lines_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    labor_hours: Mapped[float] = mapped_column(Float, default=0.0)
    subtotal_cents: Mapped[int] = mapped_column(Integer, default=0)
    vat_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    period_from: Mapped[str | None] = mapped_column(String(10), nullable=True)
    period_to: Mapped[str | None] = mapped_column(String(10), nullable=True)

    @property
    def work_date_range(self) -> tuple[date, date] | None:
        return None

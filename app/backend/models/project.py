from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin


class Project(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "projects"

    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    location: Mapped[str] = mapped_column(String(512), default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    description: Mapped[str] = mapped_column(String(2048), default="")

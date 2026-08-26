from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin

FIELD_TYPES = frozenset(
    {
        "text",
        "textarea",
        "number",
        "date",
        "time",
        "datetime",
        "yes_no",
        "yes_no_na",
        "choice",
        "multichoice",
        "checkbox",
        "measurement",
        "photo",
        "file",
        "signature",
        "location",
        "auto_user",
        "auto_datetime",
    }
)


class FormTemplate(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "form_templates"

    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str] = mapped_column(Text, default="")


class FormVersion(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "form_versions"
    __table_args__ = (
        UniqueConstraint("form_template_id", "version", name="uq_form_version"),
    )

    form_template_id: Mapped[str] = mapped_column(ForeignKey("form_templates.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    schema_json: Mapped[dict] = mapped_column(JSON, default=dict)

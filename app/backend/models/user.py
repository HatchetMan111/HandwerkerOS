from typing import Set

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.db import Base
from app.backend.models.base import TimestampMixin, UUIDPkMixin

ALL_PERMISSIONS: Set[str] = {
    "projects.read",
    "projects.write",
    "customers.read",
    "customers.write",
    "forms.read",
    "forms.write",
    "forms.execute",
    "users.read",
    "users.manage",
    "devices.manage",
    "documents.read",
    "documents.write",
    "reports.create",
    "settings.manage",
}

ROLE_PERMISSIONS: dict[str, Set[str]] = {
    "admin": ALL_PERMISSIONS,
    "manager": {
        "projects.read",
        "projects.write",
        "customers.read",
        "customers.write",
        "forms.read",
        "forms.write",
        "forms.execute",
        "users.read",
        "documents.read",
        "documents.write",
        "reports.create",
        "devices.manage",
    },
    "foreman": {
        "projects.read",
        "customers.read",
        "forms.read",
        "forms.execute",
        "documents.read",
        "documents.write",
        "reports.create",
    },
    "worker": {
        "projects.read",
        "forms.read",
        "forms.execute",
        "documents.read",
        "documents.write",
    },
    "viewer": {
        "projects.read",
        "customers.read",
        "forms.read",
        "documents.read",
    },
}


def permissions_for_role(role: str) -> Set[str]:
    return set(ROLE_PERMISSIONS.get(role, set()))


class User(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="worker")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    @property
    def permissions(self) -> Set[str]:
        return permissions_for_role(self.role)

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions

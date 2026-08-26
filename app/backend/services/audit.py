import logging
from typing import Any

from app.backend.db import SessionLocal
from app.backend.models.audit import AuditLog
from app.backend.timeutil import utcnow

logger = logging.getLogger("handwerkeros.audit")


def record(
    *,
    action: str,
    user: Any = None,
    entity: str | None = None,
    entity_id: str | None = None,
    device_id: str | None = None,
    ip: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    detail: dict[str, Any] | None = None,
    username: str | None = None,
) -> None:
    entry = AuditLog(
        at=utcnow(),
        user_id=getattr(user, "id", None),
        username=username or getattr(user, "name", None),
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        device_id=device_id,
        ip=ip,
        before=before,
        after=after,
        detail=detail,
    )
    with SessionLocal() as session:
        session.add(entry)
        session.commit()


def record_field_change(
    *,
    action: str,
    user: Any = None,
    entity: str,
    entity_id: str,
    field: str,
    old: Any,
    new: Any,
    device_id: str | None = None,
    ip: str | None = None,
) -> None:
    record(
        action=action,
        user=user,
        entity=entity,
        entity_id=entity_id,
        device_id=device_id,
        ip=ip,
        before={field: old},
        after={field: new},
    )

import logging
from typing import Any, Literal

from fastapi import HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.backend.config import settings
from app.backend.models.device import Device
from app.backend.models.inspection import Defect, Inspection
from app.backend.models.sync import SyncOperation
from app.backend.services import audit, entities
from app.backend.services.entities import (
    merge_defect_data,
    merge_inspection_data,
    snapshot_defect,
    snapshot_inspection,
)
from app.backend.timeutil import parse_ts, utcnow

logger = logging.getLogger("handwerkeros.sync")

APPLIED = "applied"
CONFLICT = "conflict"
REJECTED = "rejected"
DUPLICATE = "duplicate"


class OperationIn(BaseModel):
    operation_id: str = Field(min_length=8, max_length=64)
    entity: Literal["inspection", "defect"]
    entity_id: str = Field(min_length=8, max_length=64)
    operation: Literal["create", "update", "delete"]
    payload: dict[str, Any] = Field(default_factory=dict)
    base_version: int | None = None
    client_updated_at: str | None = None


class SyncRequest(BaseModel):
    device_id: str = Field(min_length=4, max_length=64)
    device_name: str = ""
    device_platform: str = ""
    device_app_version: str = ""
    operations: list[OperationIn] = Field(default_factory=list)


class _Ctx:
    def __init__(self, user: Any, device_id: str) -> None:
        self.user = user
        self.device_id = device_id
        self.audit_entry: dict[str, Any] | None = None

    def audit(self, **kwargs: Any) -> None:
        kwargs.setdefault("user", self.user)
        kwargs.setdefault("device_id", self.device_id)
        self.audit_entry = kwargs


def _register_device(db: Session, req: SyncRequest, user: Any) -> Device:
    device = db.get(Device, req.device_id)
    if device is None:
        device = Device(
            id=req.device_id,
            user_id=user.id,
            name=req.device_name or req.device_id,
            platform=req.device_platform,
            app_version=req.device_app_version,
        )
        db.add(device)
        db.flush()
    elif device.status == "disabled":
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Geraet ist deaktiviert")
    now = utcnow()
    device.last_seen = now
    device.last_sync = now
    if req.device_app_version:
        device.app_version = req.device_app_version
    if req.device_platform:
        device.platform = req.device_platform
    if req.device_name:
        device.name = req.device_name
    return device


def _lww_applies(op: OperationIn, server_updated_at: Any) -> bool:
    if not settings.sync_allow_lww:
        return False
    client_ts = parse_ts(op.client_updated_at)
    return client_ts is not None and server_updated_at is not None and client_ts > server_updated_at


def _conflict_payload(
    op: OperationIn, server_state: dict[str, Any], server_version: int
) -> dict[str, Any]:
    return {
        "message": "Versionskonflikt",
        "client_base_version": op.base_version,
        "server_version": server_version,
        "server_state": server_state,
    }


def _apply_inspection(
    ctx: _Ctx, db: Session, op: OperationIn
) -> tuple[str, int | None, dict[str, Any] | None, str | None]:
    row = db.get(Inspection, op.entity_id)

    if op.operation == "create":
        if row is not None:
            return DUPLICATE, row.version, None, None
        payload = op.payload
        inspection = entities.create_inspection(
            db,
            project_id=str(payload.get("project_id", "")),
            form_template_id=str(payload.get("form_template_id", "")),
            form_version_id=payload.get("form_version_id"),
            data=payload.get("data") or {},
            inspection_id=op.entity_id,
            created_by=ctx.user.id,
            device_id=ctx.device_id,
            device_created_at=parse_ts(op.client_updated_at),
        )
        ctx.audit(
            action="INSPECTION_CREATED",
            entity="inspection",
            entity_id=inspection.id,
            after=snapshot_inspection(inspection),
        )
        return APPLIED, inspection.version, None, None

    if op.operation == "update":
        if row is None:
            return REJECTED, None, None, "not_found"
        if op.base_version is None:
            return REJECTED, row.version, None, "base_version_required"
        lww = row.version != op.base_version
        if lww and not _lww_applies(op, row.updated_at):
            return (
                CONFLICT,
                row.version,
                _conflict_payload(op, snapshot_inspection(row), row.version),
                None,
            )
        before = snapshot_inspection(row)
        merge_inspection_data(row, op.payload.get("data") or {})
        row.version += 1
        detail = {"resolution": "lww"} if lww else None
        ctx.audit(
            action="INSPECTION_UPDATED",
            entity="inspection",
            entity_id=row.id,
            before=before,
            after=snapshot_inspection(row),
            detail=detail,
        )
        return APPLIED, row.version, None, None

    return REJECTED, None, None, "delete_not_supported"


def _apply_defect(
    ctx: _Ctx, db: Session, op: OperationIn
) -> tuple[str, int | None, dict[str, Any] | None, str | None]:
    row = db.get(Defect, op.entity_id)

    if op.operation == "create":
        if row is not None:
            return DUPLICATE, row.version, None, None
        payload = op.payload
        defect = entities.create_defect(
            db,
            project_id=str(payload.get("project_id", "")),
            description=str(payload.get("description", "")),
            priority=str(payload.get("priority", "medium")),
            inspection_id=payload.get("inspection_id"),
            defect_id=op.entity_id,
            created_by=ctx.user.id,
        )
        ctx.audit(
            action="DEFECT_CREATED",
            entity="defect",
            entity_id=defect.id,
            after=snapshot_defect(defect),
        )
        return APPLIED, defect.version, None, None

    if op.operation == "update":
        if row is None:
            return REJECTED, None, None, "not_found"
        if op.base_version is None:
            return REJECTED, row.version, None, "base_version_required"
        lww = row.version != op.base_version
        if lww and not _lww_applies(op, row.updated_at):
            return (
                CONFLICT,
                row.version,
                _conflict_payload(op, snapshot_defect(row), row.version),
                None,
            )
        before = snapshot_defect(row)
        merge_defect_data(row, op.payload)
        row.version += 1
        detail = {"resolution": "lww"} if lww else None
        ctx.audit(
            action="DEFECT_UPDATED",
            entity="defect",
            entity_id=row.id,
            before=before,
            after=snapshot_defect(row),
            detail=detail,
        )
        return APPLIED, row.version, None, None

    return REJECTED, None, None, "delete_not_supported"


_HANDLERS = {
    "inspection": _apply_inspection,
    "defect": _apply_defect,
}


def _exc_reason(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            return str(detail.get("message", "validation_failed"))[:255]
        return str(detail)[:255]
    logger.exception("Sync-Operation intern fehlgeschlagen")
    return "internal_error"


def _result(op_row: SyncOperation, replayed: bool = False) -> dict[str, Any]:
    return {
        "operation_id": op_row.operation_id,
        "entity": op_row.entity,
        "entity_id": op_row.entity_id,
        "status": op_row.status,
        "server_version": op_row.result_version,
        "error": op_row.error,
        "conflict": op_row.conflict_json,
        "replayed": replayed,
    }


def process(db: Session, req: SyncRequest, user: Any, ip: str | None = None) -> dict[str, Any]:
    _register_device(db, req, user)
    results: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []

    for op in req.operations:
        existing = db.get(SyncOperation, op.operation_id)
        if existing is not None:
            results.append(_result(existing, replayed=True))
            continue

        op_row = SyncOperation(
            operation_id=op.operation_id,
            device_id=req.device_id,
            user_id=user.id,
            entity=op.entity,
            entity_id=op.entity_id,
            operation=op.operation,
            payload=op.payload,
            base_version=op.base_version,
            client_updated_at=parse_ts(op.client_updated_at),
        )
        db.add(op_row)
        ctx = _Ctx(user, req.device_id)
        error: str | None = None
        try:
            status_value, version, conflict, error = _HANDLERS[op.entity](ctx, db, op)
        except HTTPException as exc:
            status_value, version, conflict = REJECTED, None, None
            error = _exc_reason(exc)
        except Exception as exc:
            status_value, version, conflict = REJECTED, None, None
            error = _exc_reason(exc)
        finally:
            op_row.status = status_value
            op_row.result_version = version
            op_row.conflict_json = conflict
            op_row.error = error
            op_row.processed_at = utcnow()

        results.append(_result(op_row))

        if status_value == CONFLICT and conflict is not None:
            audits.append(
                {
                    "action": "SYNC_CONFLICT",
                    "user": user,
                    "entity": op.entity,
                    "entity_id": op.entity_id,
                    "device_id": req.device_id,
                    "ip": ip,
                    "detail": conflict,
                }
            )
        elif status_value == APPLIED and ctx.audit_entry is not None:
            entry = ctx.audit_entry
            entry.setdefault("ip", ip)
            audits.append(entry)

    db.commit()

    for entry in audits:
        audit.record(**entry)

    return {"results": results, "server_time": utcnow().isoformat() + "Z"}

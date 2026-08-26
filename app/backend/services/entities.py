from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.backend.models.form import FormTemplate, FormVersion
from app.backend.models.inspection import (
    ALLOWED_TRANSITIONS,
    EDITABLE_STATUSES,
    Defect,
    Inspection,
)
from app.backend.timeutil import utcnow


def resolve_form_version(
    db: Session, template_id: str, form_version_id: str | None
) -> FormVersion:
    template = db.get(FormTemplate, template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formularvorlage nicht gefunden")
    if form_version_id:
        version = db.get(FormVersion, form_version_id)
        if version is None or version.form_template_id != template_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "form_version_id gehoert nicht zur Vorlage",
            )
        return version
    version = (
        db.query(FormVersion)
        .filter(FormVersion.form_template_id == template_id)
        .order_by(FormVersion.version.desc())
        .first()
    )
    if version is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Vorlage hat keine Version")
    return version


def create_inspection(
    db: Session,
    *,
    project_id: str,
    form_template_id: str,
    data: dict[str, Any] | None = None,
    form_version_id: str | None = None,
    inspection_id: str | None = None,
    created_by: str | None = None,
    device_id: str | None = None,
    device_created_at=None,
) -> Inspection:
    from app.backend.models.project import Project

    if db.get(Project, project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    version = resolve_form_version(db, form_template_id, form_version_id)
    kwargs = {"id": inspection_id} if inspection_id else {}
    inspection = Inspection(
        project_id=project_id,
        form_template_id=form_template_id,
        form_version_id=version.id,
        data_json=dict(data or {}),
        created_by=created_by,
        device_id=device_id,
        device_created_at=device_created_at,
        **kwargs,
    )
    db.add(inspection)
    db.flush()
    return inspection


def snapshot_inspection(inspection: Inspection) -> dict[str, Any]:
    return {
        "data": dict(inspection.data_json or {}),
        "status": inspection.status,
        "version": inspection.version,
    }


def merge_inspection_data(
    inspection: Inspection, new_data: dict[str, Any]
) -> dict[str, Any]:
    before = snapshot_inspection(inspection)
    merged = dict(inspection.data_json or {})
    merged.update(new_data)
    inspection.data_json = merged
    inspection.updated_at = utcnow()
    return before


def check_editable(inspection: Inspection) -> None:
    if inspection.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Status {inspection.status} ist gesperrt; Aenderung nur ueber Revision",
        )


def check_optimistic_lock(
    row_version: int, base_version: int | None, server_state: dict[str, Any]
) -> None:
    if base_version is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "base_version erforderlich (optimistische Synchronisation)",
        )
    if row_version != base_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": "Versionskonflikt",
                "server_version": row_version,
                "client_base_version": base_version,
                "server_state": server_state,
            },
        )


def transition_inspection(inspection: Inspection, new_status: str) -> None:
    allowed = ALLOWED_TRANSITIONS.get(inspection.status, ())
    if new_status not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Uebergang {inspection.status} -> {new_status} nicht erlaubt",
        )
    old_status = inspection.status
    inspection.status = new_status
    inspection.version += 1
    inspection.updated_at = utcnow()
    if new_status == "completed":
        inspection.completed_at = utcnow()
    return old_status


def complete_inspection(
    db: Session, inspection: Inspection
) -> list[dict[str, str]]:
    from app.backend.services.forms_schema import missing_required

    version = db.get(FormVersion, inspection.form_version_id)
    missing = missing_required(version.schema_json if version else {}, inspection.data_json or {})
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, {"missing_required": missing}
        )
    transition_inspection(inspection, "completed")
    return missing


def create_defect(
    db: Session,
    *,
    project_id: str,
    description: str,
    priority: str = "medium",
    inspection_id: str | None = None,
    defect_id: str | None = None,
    created_by: str | None = None,
) -> Defect:
    from app.backend.models.project import Project

    if db.get(Project, project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    if inspection_id and db.get(Inspection, inspection_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pruefung nicht gefunden")
    kwargs = {"id": defect_id} if defect_id else {}
    defect = Defect(
        project_id=project_id,
        inspection_id=inspection_id,
        description=description,
        priority=priority,
        created_by=created_by,
        **kwargs,
    )
    db.add(defect)
    db.flush()
    return defect


DEFECT_FIELDS = ("description", "priority", "status")


def snapshot_defect(defect: Defect) -> dict[str, Any]:
    return {
        "description": defect.description,
        "priority": defect.priority,
        "status": defect.status,
        "version": defect.version,
    }


def merge_defect_data(defect: Defect, payload: dict[str, Any]) -> dict[str, Any]:
    before = snapshot_defect(defect)
    for key in DEFECT_FIELDS:
        if key in payload and payload[key] is not None:
            setattr(defect, key, str(payload[key]))
    defect.updated_at = utcnow()
    return before

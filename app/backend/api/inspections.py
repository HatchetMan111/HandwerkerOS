from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, get_device_id, require_permission
from app.backend.db import get_db
from app.backend.models.inspection import Inspection
from app.backend.models.user import User
from app.backend.services import audit, entities
from app.backend.services.entities import (
    check_editable,
    check_optimistic_lock,
    snapshot_inspection,
)
from app.backend.services.serializers import serialize_inspection

router = APIRouter(prefix="/inspections", tags=["inspections"])


class InspectionCreate(BaseModel):
    project_id: str
    form_template_id: str
    form_version_id: str | None = None
    data: dict[str, Any] = {}


class InspectionUpdate(BaseModel):
    data: dict[str, Any]
    base_version: int


class TransitionIn(BaseModel):
    status: str


def _get_inspection(db: Session, inspection_id: str) -> Inspection:
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pruefung nicht gefunden")
    return inspection


@router.get("")
def list_inspections(
    project_id: str | None = None,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    query = db.query(Inspection).order_by(Inspection.updated_at.desc())
    if project_id:
        query = query.filter(Inspection.project_id == project_id)
    if status_filter:
        query = query.filter(Inspection.status == status_filter)
    return [serialize_inspection(i) for i in query.limit(500).all()]


@router.get("/{inspection_id}")
def get_inspection(
    inspection_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    return serialize_inspection(_get_inspection(db, inspection_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_inspection(
    body: InspectionCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
    device_id: str | None = Depends(get_device_id),
):
    inspection = entities.create_inspection(
        db,
        project_id=body.project_id,
        form_template_id=body.form_template_id,
        form_version_id=body.form_version_id,
        data=body.data,
        created_by=actor.id,
        device_id=device_id,
    )
    snapshot = snapshot_inspection(inspection)
    db.commit()
    audit.record(
        action="INSPECTION_CREATED",
        user=actor,
        entity="inspection",
        entity_id=inspection.id,
        device_id=device_id,
        ip=ip,
        after=snapshot,
    )
    return serialize_inspection(inspection)


@router.patch("/{inspection_id}")
def update_inspection(
    inspection_id: str,
    body: InspectionUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
    device_id: str | None = Depends(get_device_id),
):
    inspection = _get_inspection(db, inspection_id)
    check_editable(inspection)
    check_optimistic_lock(inspection.version, body.base_version, snapshot_inspection(inspection))
    before = entities.merge_inspection_data(inspection, body.data)
    inspection.version += 1
    after = snapshot_inspection(inspection)
    db.commit()
    audit.record(
        action="INSPECTION_UPDATED",
        user=actor,
        entity="inspection",
        entity_id=inspection.id,
        device_id=device_id,
        ip=ip,
        before=before,
        after=after,
    )
    return serialize_inspection(inspection)


@router.post("/{inspection_id}/complete")
def complete_inspection(
    inspection_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
    device_id: str | None = Depends(get_device_id),
):
    inspection = _get_inspection(db, inspection_id)
    before = snapshot_inspection(inspection)
    entities.complete_inspection(db, inspection)
    db.commit()
    audit.record(
        action="INSPECTION_COMPLETED",
        user=actor,
        entity="inspection",
        entity_id=inspection.id,
        device_id=device_id,
        ip=ip,
        before=before,
        after=snapshot_inspection(inspection),
    )
    return serialize_inspection(inspection)


@router.post("/{inspection_id}/transition")
def transition_inspection(
    inspection_id: str,
    body: TransitionIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
    device_id: str | None = Depends(get_device_id),
):
    inspection = _get_inspection(db, inspection_id)
    old_status = entities.transition_inspection(inspection, body.status)
    db.commit()
    audit.record(
        action="INSPECTION_STATUS_CHANGED",
        user=actor,
        entity="inspection",
        entity_id=inspection.id,
        device_id=device_id,
        ip=ip,
        before={"status": old_status},
        after={"status": inspection.status},
    )
    return serialize_inspection(inspection)

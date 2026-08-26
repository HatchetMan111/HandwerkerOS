from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.inspection import Defect
from app.backend.models.user import User
from app.backend.services import audit, entities
from app.backend.services.serializers import serialize_defect

router = APIRouter(prefix="/defects", tags=["defects"])

PRIORITIES = ("low", "medium", "high")
DEFECT_STATUSES = ("open", "resolved")


class DefectCreate(BaseModel):
    project_id: str
    description: str = Field(min_length=3, max_length=4096)
    priority: str = "medium"
    inspection_id: str | None = None


class DefectUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=3, max_length=4096)
    priority: str | None = None
    status: str | None = None
    base_version: int


def _get_defect(db: Session, defect_id: str) -> Defect:
    defect = db.get(Defect, defect_id)
    if defect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mangel nicht gefunden")
    return defect


@router.get("")
def list_defects(
    project_id: str | None = None,
    inspection_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    query = db.query(Defect).order_by(Defect.updated_at.desc())
    if project_id:
        query = query.filter(Defect.project_id == project_id)
    if inspection_id:
        query = query.filter(Defect.inspection_id == inspection_id)
    return [serialize_defect(d) for d in query.limit(500).all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_defect(
    body: DefectCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
):
    if body.priority not in PRIORITIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannte Prioritaet")
    defect = entities.create_defect(
        db,
        project_id=body.project_id,
        description=body.description,
        priority=body.priority,
        inspection_id=body.inspection_id,
        created_by=actor.id,
    )
    after = entities.snapshot_defect(defect)
    db.commit()
    audit.record(
        action="DEFECT_CREATED",
        user=actor,
        entity="defect",
        entity_id=defect.id,
        ip=ip,
        after=after,
    )
    return serialize_defect(defect)


@router.patch("/{defect_id}")
def update_defect(
    defect_id: str,
    body: DefectUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
):
    defect = _get_defect(db, defect_id)
    if body.priority is not None and body.priority not in PRIORITIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannte Prioritaet")
    if body.status is not None and body.status not in DEFECT_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Mangelstatus")
    entities.check_optimistic_lock(
        defect.version, body.base_version, entities.snapshot_defect(defect)
    )
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    before = entities.merge_defect_data(defect, payload)
    defect.version += 1
    after = entities.snapshot_defect(defect)
    db.commit()
    audit.record(
        action="DEFECT_UPDATED",
        user=actor,
        entity="defect",
        entity_id=defect.id,
        ip=ip,
        before=before,
        after=after,
    )
    return serialize_defect(defect)

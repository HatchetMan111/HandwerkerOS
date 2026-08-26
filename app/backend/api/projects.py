from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.project import Project
from app.backend.models.user import User
from app.backend.services import audit
from app.backend.services.serializers import serialize_project

router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_STATUSES = ("planned", "active", "paused", "done")


class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    customer_id: str | None = None
    location: str = Field(default="", max_length=512)
    status: str = "active"
    description: str = Field(default="", max_length=2048)


@router.get("")
def list_projects(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    query = db.query(Project).order_by(Project.updated_at.desc())
    if status_filter:
        query = query.filter(Project.status == status_filter)
    return [serialize_project(p) for p in query.limit(500).all()]


@router.get("/{project_id}")
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    return serialize_project(project)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.write")),
    ip: str | None = Depends(get_client_ip),
):
    if body.status not in PROJECT_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Projektstatus")
    if body.customer_id:
        from app.backend.models.customer import Customer

        if db.get(Customer, body.customer_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Kunde nicht gefunden")
    project = Project(
        name=body.name,
        customer_id=body.customer_id,
        location=body.location,
        status=body.status,
        description=body.description,
    )
    db.add(project)
    db.commit()
    audit.record(
        action="PROJECT_CREATED",
        user=actor,
        entity="project",
        entity_id=project.id,
        ip=ip,
        after={"name": project.name, "status": project.status},
    )
    return serialize_project(project)


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    body: ProjectIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.write")),
    ip: str | None = Depends(get_client_ip),
):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    if body.status not in PROJECT_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Projektstatus")
    before = {"name": project.name, "status": project.status, "location": project.location}
    project.name = body.name
    project.customer_id = body.customer_id
    project.location = body.location
    project.status = body.status
    project.description = body.description
    db.commit()
    audit.record(
        action="PROJECT_UPDATED",
        user=actor,
        entity="project",
        entity_id=project.id,
        ip=ip,
        before=before,
        after={"name": project.name, "status": project.status, "location": project.location},
    )
    return serialize_project(project)

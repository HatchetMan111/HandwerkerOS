from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, get_current_user
from app.backend.db import get_db
from app.backend.models.customer import Customer
from app.backend.models.form import FormTemplate, FormVersion
from app.backend.models.inspection import Defect, Inspection
from app.backend.models.project import Project
from app.backend.models.timematerial import Assignment, MaterialItem, MaterialUsage, TimeEntry
from app.backend.models.user import User
from app.backend.services.serializers import (
    serialize_assignment,
    serialize_customer,
    serialize_defect,
    serialize_form_version,
    serialize_inspection,
    serialize_material_item,
    serialize_material_usage,
    serialize_project,
    serialize_time_entry,
)
from app.backend.sync.engine import SyncRequest, process
from app.backend.timeutil import iso_z, parse_ts, utcnow

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("")
def post_sync(
    request: SyncRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    ip: str | None = Depends(get_client_ip),
):
    return process(db, request, user, ip=ip)


@router.get("/changes")
def pull_changes(
    since: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    since_dt = parse_ts(since) or (utcnow() - timedelta(days=3650))
    inspections = (
        db.query(Inspection).filter(Inspection.updated_at > since_dt).limit(limit).all()
    )
    defects = db.query(Defect).filter(Defect.updated_at > since_dt).limit(limit).all()
    projects = db.query(Project).filter(Project.updated_at > since_dt).limit(limit).all()
    customers = db.query(Customer).filter(Customer.updated_at > since_dt).limit(limit).all()
    templates = (
        db.query(FormTemplate).filter(FormTemplate.updated_at > since_dt).limit(limit).all()
    )
    versions = (
        db.query(FormVersion).filter(FormVersion.updated_at > since_dt).limit(limit).all()
    )
    return {
        "server_time": iso_z(utcnow()),
        "since": iso_z(since_dt),
        "customers": [serialize_customer(c) for c in customers],
        "projects": [serialize_project(p) for p in projects],
        "form_templates": [
            {
                "id": t.id,
                "name": t.name,
                "category": t.category,
                "updated_at": iso_z(t.updated_at),
            }
            for t in templates
        ],
        "form_versions": [serialize_form_version(v) for v in versions],
        "inspections": [serialize_inspection(i) for i in inspections],
        "defects": [serialize_defect(d) for d in defects],
        "time_entries": [
            serialize_time_entry(e)
            for e in db.query(TimeEntry).filter(TimeEntry.updated_at > since_dt).limit(limit).all()
        ],
        "material_usages": [
            serialize_material_usage(u)
            for u in db.query(MaterialUsage)
            .filter(MaterialUsage.updated_at > since_dt)
            .limit(limit)
            .all()
        ],
        "assignments": [
            serialize_assignment(a)
            for a in db.query(Assignment)
            .filter(Assignment.updated_at > since_dt)
            .limit(limit)
            .all()
        ],
        "materials": [serialize_material_item(m) for m in db.query(MaterialItem).limit(500).all()],
    }

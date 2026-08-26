from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.form import FormTemplate, FormVersion
from app.backend.models.user import User
from app.backend.services import audit, forms_schema
from app.backend.services.serializers import serialize_form_template, serialize_form_version

router = APIRouter(prefix="/forms", tags=["forms"])


class TemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    category: str = Field(default="", max_length=64)
    description: str = Field(default="", max_length=2048)
    form_schema: dict = Field(alias="schema")


class VersionCreate(BaseModel):
    form_schema: dict = Field(alias="schema")


def _validated_schema(schema: dict) -> None:
    errors = forms_schema.validate_schema(schema)
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"schema_errors": errors})


def _versions(db: Session, template_id: str) -> list[FormVersion]:
    return (
        db.query(FormVersion)
        .filter(FormVersion.form_template_id == template_id)
        .order_by(FormVersion.version)
        .all()
    )


@router.get("/templates")
def list_templates(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("forms.read")),
):
    templates = db.query(FormTemplate).order_by(FormTemplate.name).all()
    result = []
    for template in templates:
        versions = _versions(db, template.id)
        summary = serialize_form_template(template, versions, include_schema=False)
        summary.pop("versions", None)
        result.append(summary)
    return result


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.write")),
    ip: str | None = Depends(get_client_ip),
):
    _validated_schema(body.form_schema)
    template = FormTemplate(name=body.name, category=body.category, description=body.description)
    db.add(template)
    db.flush()
    version = FormVersion(form_template_id=template.id, version=1, schema_json=body.form_schema)
    db.add(version)
    db.commit()
    audit.record(
        action="FORM_TEMPLATE_CREATED",
        user=actor,
        entity="form_template",
        entity_id=template.id,
        ip=ip,
        after={"name": template.name, "version": 1},
    )
    return serialize_form_template(template, [version], include_schema=True)


@router.get("/templates/{template_id}")
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("forms.read")),
):
    template = db.get(FormTemplate, template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formularvorlage nicht gefunden")
    versions = _versions(db, template.id)
    return serialize_form_template(template, versions, include_schema=True)


@router.post("/templates/{template_id}/versions", status_code=status.HTTP_201_CREATED)
def create_version(
    template_id: str,
    body: VersionCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.write")),
    ip: str | None = Depends(get_client_ip),
):
    template = db.get(FormTemplate, template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formularvorlage nicht gefunden")
    _validated_schema(body.form_schema)
    existing = _versions(db, template.id)
    next_version = (existing[-1].version + 1) if existing else 1
    version = FormVersion(
        form_template_id=template.id, version=next_version, schema_json=body.form_schema
    )
    db.add(version)
    db.commit()
    audit.record(
        action="FORM_VERSION_CREATED",
        user=actor,
        entity="form_template",
        entity_id=template.id,
        ip=ip,
        detail={"version": next_version},
    )
    return serialize_form_version(version, include_schema=True)

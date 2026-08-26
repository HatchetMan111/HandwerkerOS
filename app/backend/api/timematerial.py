from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, get_current_user, require_permission
from app.backend.db import get_db
from app.backend.models.inspection import Defect, Inspection
from app.backend.models.project import Project
from app.backend.models.timematerial import (
    Assignment,
    Invoice,
    MaterialItem,
    MaterialUsage,
    TimeEntry,
)
from app.backend.models.user import User
from app.backend.services import audit
from app.backend.services.serializers import (
    serialize_assignment,
    serialize_invoice,
    serialize_material_item,
    serialize_material_usage,
    serialize_time_entry,
)

router = APIRouter(prefix="/time", tags=["time-material"])

TIME_STATUSES = ("draft", "submitted", "approved", "rejected")
ASSIGNMENT_STATUSES = ("planned", "confirmed", "done", "canceled")


def _get_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    return project


class TimeEntryIn(BaseModel):
    project_id: str
    work_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hours: float = Field(gt=0, le=24)
    activity: str = Field(default="", max_length=2048)
    user_id: str | None = None


class TimeEntryPatch(BaseModel):
    hours: float | None = Field(default=None, gt=0, le=24)
    activity: str | None = None
    status: str | None = None
    base_version: int


@router.get("/entries")
def list_entries(
    project_id: str | None = None,
    status_filter: str | None = None,
    mine_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("projects.read")),
):
    query = db.query(TimeEntry).order_by(TimeEntry.work_date.desc(), TimeEntry.created_at.desc())
    if project_id:
        query = query.filter(TimeEntry.project_id == project_id)
    if status_filter:
        query = query.filter(TimeEntry.status == status_filter)
    if mine_only and not user.has_permission("reports.create"):
        query = query.filter(TimeEntry.user_id == user.id)
    return [serialize_time_entry(e) for e in query.limit(500).all()]


@router.post("/entries", status_code=status.HTTP_201_CREATED)
def create_entry(
    body: TimeEntryIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.read")),
    ip: str | None = Depends(get_client_ip),
):
    _get_project(db, body.project_id)
    target_user = body.user_id or actor.id
    if target_user != actor.id and not actor.has_permission("reports.create"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Fremde Zeiten nur mit Freigabe-Berechtigung",
        )
    entry = TimeEntry(
        project_id=body.project_id,
        user_id=target_user,
        work_date=body.work_date,
        hours=body.hours,
        activity=body.activity,
    )
    db.add(entry)
    db.commit()
    audit.record(
        action="TIME_ENTRY_CREATED",
        user=actor,
        entity="time_entry",
        entity_id=entry.id,
        ip=ip,
        after={"hours": entry.hours, "work_date": entry.work_date},
    )
    return serialize_time_entry(entry)


@router.patch("/entries/{entry_id}")
def patch_entry(
    entry_id: str,
    body: TimeEntryPatch,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.read")),
    ip: str | None = Depends(get_client_ip),
):
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Zeiteintrag nicht gefunden")
    if entry.version != body.base_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"message": "Versionskonflikt", "server_version": entry.version},
        )
    if actor.id != entry.user_id and not actor.has_permission("reports.create"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Keine Berechtigung fuer fremde Zeiten")

    before = {"hours": entry.hours, "status": entry.status}
    approver_change = (
        body.status in ("approved", "rejected", "submitted") and body.status != entry.status
    )
    if approver_change:
        if not actor.has_permission("reports.create"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Freigabe nur mit reports.create")
        entry.status = body.status
    else:
        if entry.status == "approved":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Freigegebene Zeiten sind gesperrt (Rechnungsgrundlage)",
            )
        if body.status is not None:
            if body.status not in TIME_STATUSES:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Status")
            entry.status = body.status
        if body.hours is not None:
            entry.hours = body.hours
        if body.activity is not None:
            entry.activity = body.activity
    entry.version += 1
    db.commit()
    audit.record(
        action="TIME_ENTRY_UPDATED",
        user=actor,
        entity="time_entry",
        entity_id=entry.id,
        ip=ip,
        before=before,
        after={"hours": entry.hours, "status": entry.status},
    )
    return serialize_time_entry(entry)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.read")),
    ip: str | None = Depends(get_client_ip),
):
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Zeiteintrag nicht gefunden")
    if entry.status == "approved" and not actor.has_permission("reports.create"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Freigegebene Zeiten sind gesperrt")
    if actor.id != entry.user_id and not actor.has_permission("reports.create"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Keine Berechtigung fuer fremde Zeiten")
    audit.record(
        action="TIME_ENTRY_DELETED",
        user=actor,
        entity="time_entry",
        entity_id=entry_id,
        ip=ip,
        detail={"hours": entry.hours, "work_date": entry.work_date},
    )
    db.delete(entry)
    db.commit()


@router.get("/summary")
def time_summary(
    project_id: str,
    status_filter: str = "approved",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    rows = (
        db.query(TimeEntry.user_id, func.sum(TimeEntry.hours))
        .filter(TimeEntry.project_id == project_id, TimeEntry.status == status_filter)
        .group_by(TimeEntry.user_id)
        .all()
    )
    names = {u.id: u.name for u in db.query(User).all()}
    return [
        {"user_id": uid, "user_name": names.get(uid, "?"), "hours": round(float(total), 2)}
        for uid, total in rows
    ]


MATERIAL_ROUTER_TAG = "Materialkatalog und Verbrauch"


class MaterialItemIn(BaseModel):
    article_number: str = Field(default="", max_length=64)
    name: str = Field(min_length=2, max_length=255)
    unit: str = Field(default="Stk", max_length=16)
    price_cents: int = Field(ge=0)


class MaterialUsageIn(BaseModel):
    project_id: str
    work_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    material_id: str | None = None
    name: str | None = Field(default=None, max_length=255)
    quantity: float = Field(gt=0)
    price_cents: int | None = Field(default=None, ge=0)
    note: str = ""


material_router = APIRouter(prefix="/materials", tags=["materials"])


@material_router.get("")
def list_materials(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    items = db.query(MaterialItem).order_by(MaterialItem.name).all()
    return [serialize_material_item(i) for i in items]


@material_router.post("", status_code=status.HTTP_201_CREATED)
def create_material(
    body: MaterialItemIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.write")),
    ip: str | None = Depends(get_client_ip),
):
    item = MaterialItem(**body.model_dump())
    db.add(item)
    db.commit()
    audit.record(
        action="MATERIAL_CREATED", user=actor, entity="material", entity_id=item.id, ip=ip
    )
    return serialize_material_item(item)


@material_router.get("/usages")
def list_usages(
    project_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    query = db.query(MaterialUsage).order_by(MaterialUsage.work_date.desc())
    if project_id:
        query = query.filter(MaterialUsage.project_id == project_id)
    return [serialize_material_usage(u) for u in query.limit(500).all()]


@material_router.post("/usages", status_code=status.HTTP_201_CREATED)
def create_usage(
    body: MaterialUsageIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.read")),
    ip: str | None = Depends(get_client_ip),
):
    _get_project(db, body.project_id)
    catalog = db.get(MaterialItem, body.material_id) if body.material_id else None
    usage = MaterialUsage(
        project_id=body.project_id,
        material_id=catalog.id if catalog else None,
        name=body.name or (catalog.name if catalog else ""),
        unit=catalog.unit if catalog else "Stk",
        quantity=body.quantity,
        price_cents=(
            body.price_cents
            if body.price_cents is not None
            else (catalog.price_cents if catalog else 0)
        ),
        work_date=body.work_date,
        note=body.note,
    )
    if not usage.name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Name oder material_id erforderlich",
        )
    db.add(usage)
    db.commit()
    audit.record(
        action="MATERIAL_USED",
        user=actor,
        entity="material_usage",
        entity_id=usage.id,
        ip=ip,
        after={"name": usage.name, "quantity": usage.quantity},
    )
    return serialize_material_usage(usage)


@material_router.delete("/usages/{usage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_usage(
    usage_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("forms.execute")),
    ip: str | None = Depends(get_client_ip),
):
    usage = db.get(MaterialUsage, usage_id)
    if usage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Verbrauch nicht gefunden")
    audit.record(
        action="MATERIAL_USAGE_DELETED",
        user=actor,
        entity="material_usage",
        entity_id=usage_id,
        ip=ip,
    )
    db.delete(usage)
    db.commit()


assignment_router = APIRouter(prefix="/assignments", tags=["assignments"])


class AssignmentIn(BaseModel):
    project_id: str
    user_id: str
    work_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hours_planned: float | None = Field(default=None, gt=0, le=24)
    note: str = ""
    status: str = "planned"


@assignment_router.get("")
def list_assignments(
    week_start: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    query = db.query(Assignment).order_by(Assignment.work_date)
    if week_start:
        try:
            start = date.fromisoformat(week_start)
        except ValueError as exc:
            raise HTTPException(422, "week_start muss YYYY-MM-DD sein") from exc
        end = start + timedelta(days=6)
        query = query.filter(Assignment.work_date >= start.isoformat())
        query = query.filter(Assignment.work_date <= end.isoformat())
    return [serialize_assignment(a) for a in query.limit(500).all()]


@assignment_router.post("", status_code=status.HTTP_201_CREATED)
def create_assignment(
    body: AssignmentIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.write")),
    ip: str | None = Depends(get_client_ip),
):
    _get_project(db, body.project_id)
    if db.get(User, body.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Benutzer nicht gefunden")
    assignment = Assignment(**body.model_dump())
    db.add(assignment)
    db.commit()
    audit.record(
        action="ASSIGNMENT_CREATED",
        user=actor,
        entity="assignment",
        entity_id=assignment.id,
        ip=ip,
        after={"work_date": assignment.work_date, "status": assignment.status},
    )
    return serialize_assignment(assignment)


@assignment_router.patch("/{assignment_id}")
def patch_assignment(
    assignment_id: str,
    body: dict,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("projects.write")),
    ip: str | None = Depends(get_client_ip),
):
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Einsatzplan nicht gefunden")
    new_status = str(body.get("status", ""))
    if new_status not in ASSIGNMENT_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Status")
    old = assignment.status
    assignment.status = new_status
    db.commit()
    audit.record(
        action="ASSIGNMENT_STATUS_CHANGED",
        user=actor,
        entity="assignment",
        entity_id=assignment.id,
        ip=ip,
        before={"status": old},
        after={"status": new_status},
    )
    return serialize_assignment(assignment)


invoice_router = APIRouter(prefix="/invoices", tags=["invoices"])


class InvoiceCreate(BaseModel):
    project_id: str
    hourly_rate_cents: int = Field(default=4500, ge=0)
    tax_percent: int = Field(default=19, ge=0, le=25)
    include_status: str = Field(default="approved")
    period_from: str | None = None
    period_to: str | None = None


class InvoicePatch(BaseModel):
    status: str


def _build_lines(db: Session, invoice_in: InvoiceCreate) -> tuple[list[dict], float]:
    _get_project(db, invoice_in.project_id)
    hours_rows = (
        db.query(TimeEntry.user_id, func.sum(TimeEntry.hours))
        .filter(
            TimeEntry.project_id == invoice_in.project_id,
            TimeEntry.status == invoice_in.include_status,
        )
        .group_by(TimeEntry.user_id)
        .all()
    )
    lines: list[dict] = []
    total_hours = 0.0
    names = {u.id: u.name for u in db.query(User).all()}
    for uid, hours in sorted(hours_rows, key=lambda r: names.get(r[0], "?")):
        hours = float(hours)
        total_hours += hours
        lines.append(
            {
                "type": "labor",
                "ref_id": uid,
                "description": f"Arbeitsleistung {names.get(uid, '?')}",
                "quantity": round(hours, 2),
                "unit": "Std",
                "unit_price_cents": invoice_in.hourly_rate_cents,
                "total_cents": int(round(hours * invoice_in.hourly_rate_cents)),
            }
        )
    usages = (
        db.query(MaterialUsage)
        .filter(MaterialUsage.project_id == invoice_in.project_id)
        .order_by(MaterialUsage.work_date)
        .all()
    )
    for usage in usages:
        line_total = int(round(usage.quantity * usage.price_cents))
        lines.append(
            {
                "type": "material",
                "ref_id": usage.id,
                "description": usage.name + (f" ({usage.note})" if usage.note else ""),
                "quantity": usage.quantity,
                "unit": usage.unit,
                "unit_price_cents": usage.price_cents,
                "total_cents": line_total,
            }
        )
    return lines, total_hours


@invoice_router.post("/preview")
def preview_invoice(
    body: InvoiceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("reports.create")),
):
    lines, labor_hours = _build_lines(db, body)
    subtotal = sum(line["total_cents"] for line in lines)
    vat = subtotal * body.tax_percent // 100
    return {
        "lines": lines,
        "labor_hours": round(labor_hours, 2),
        "subtotal_cents": subtotal,
        "vat_cents": vat,
        "total_cents": subtotal + vat,
        "hourly_rate_cents": body.hourly_rate_cents,
        "tax_percent": body.tax_percent,
    }


@invoice_router.get("")
def list_invoices(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("reports.create")),
):
    invoices = db.query(Invoice).order_by(Invoice.number.desc()).all()
    return [serialize_invoice(i) for i in invoices]


@invoice_router.get("/{invoice_id}")
def get_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("reports.create")),
):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rechnung nicht gefunden")
    return serialize_invoice(invoice)


@invoice_router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice(
    body: InvoiceCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("reports.create")),
    ip: str | None = Depends(get_client_ip),
):
    lines, labor_hours = _build_lines(db, body)
    if not lines:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Keine abrechenbaren Positionen (Zeiten/Material) fuer dieses Projekt",
        )
    subtotal = sum(line["total_cents"] for line in lines)
    vat = subtotal * body.tax_percent // 100
    year = date.today().year
    count = db.query(Invoice).filter(Invoice.number.like(f"{year}-%")).count()
    number = f"{year}-{count + 1:04d}"
    while db.query(Invoice).filter(Invoice.number == number).first() is not None:
        count += 1
        number = f"{year}-{count + 1:04d}"
    project = db.get(Project, body.project_id)
    customer_name = ""
    if project and project.customer_id:
        from app.backend.models.customer import Customer

        customer = db.get(Customer, project.customer_id)
        customer_name = customer.name if customer else ""
    invoice = Invoice(
        number=number,
        project_id=body.project_id,
        customer_name=customer_name,
        project_name=project.name if project else "",
        hourly_rate_cents=body.hourly_rate_cents,
        tax_percent=body.tax_percent,
        lines_json=lines,
        labor_hours=round(labor_hours, 2),
        subtotal_cents=subtotal,
        vat_cents=vat,
        total_cents=subtotal + vat,
        period_from=body.period_from,
        period_to=body.period_to,
    )
    db.add(invoice)
    db.commit()
    audit.record(
        action="INVOICE_CREATED",
        user=actor,
        entity="invoice",
        entity_id=invoice.id,
        ip=ip,
        after={"number": number, "total_cents": invoice.total_cents},
    )
    return serialize_invoice(invoice)


@invoice_router.patch("/{invoice_id}")
def patch_invoice(
    invoice_id: str,
    body: InvoicePatch,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("reports.create")),
    ip: str | None = Depends(get_client_ip),
):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rechnung nicht gefunden")
    if body.status not in ("draft", "final", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannter Status")
    old = invoice.status
    invoice.status = body.status
    db.commit()
    audit.record(
        action="INVOICE_STATUS_CHANGED",
        user=actor,
        entity="invoice",
        entity_id=invoice.id,
        ip=ip,
        before={"status": old},
        after={"status": body.status},
    )
    return serialize_invoice(invoice)


@invoice_router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("reports.create")),
    ip: str | None = Depends(get_client_ip),
):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rechnung nicht gefunden")
    if invoice.status == "final":
        raise HTTPException(status.HTTP_409_CONFLICT, "Finalisierte Rechnung ist unveränderbar")
    audit.record(
        action="INVOICE_DELETED",
        user=actor,
        entity="invoice",
        entity_id=invoice_id,
        ip=ip,
        detail={"number": invoice.number},
    )
    db.delete(invoice)
    db.commit()


PROJECT_PHOTOS_NOTE = "Gewaehrleistungs-Fotos laufen ueber /api/files mit entity_type=project"


@router.get("/project/{project_id}/overview")
def project_overview(
    project_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("projects.read")),
):
    project = _get_project(db, project_id)
    inspections_count = (
        db.query(Inspection).filter(Inspection.project_id == project_id).count()
    )
    open_defects = (
        db.query(Defect)
        .filter(Defect.project_id == project_id, Defect.status == "open")
        .count()
    )
    approved_hours = (
        db.query(func.coalesce(func.sum(TimeEntry.hours), 0.0))
        .filter(TimeEntry.project_id == project_id, TimeEntry.status == "approved")
        .scalar()
    )
    planned_hours = (
        db.query(func.coalesce(func.sum(TimeEntry.hours), 0.0))
        .filter(TimeEntry.project_id == project_id, TimeEntry.status == "planned")
        .scalar()
    )
    material_cost_cents = (
        db.query(func.coalesce(func.sum(MaterialUsage.quantity * MaterialUsage.price_cents), 0))
        .filter(MaterialUsage.project_id == project_id)
        .scalar()
    )
    plan = (
        db.query(Assignment)
        .filter(Assignment.project_id == project_id)
        .filter(Assignment.status.in_(("planned", "confirmed")))
        .order_by(Assignment.work_date)
        .limit(10)
        .all()
    )
    return {
        "project": project.name,
        "inspections_count": inspections_count,
        "open_defects": open_defects,
        "approved_hours": round(float(approved_hours), 2),
        "planned_hours_unused": round(float(planned_hours), 2),
        "material_cost_cents": int(material_cost_cents),
        "upcoming_assignments": [serialize_assignment(a) for a in plan],
    }

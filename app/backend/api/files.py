from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, get_current_user, require_permission
from app.backend.config import settings
from app.backend.db import get_db
from app.backend.models.attachment import Attachment
from app.backend.models.base import new_uuid
from app.backend.models.inspection import Defect, Inspection
from app.backend.models.project import Project
from app.backend.models.user import User
from app.backend.services import audit, storage
from app.backend.services.serializers import serialize_attachment
from app.backend.timeutil import parse_ts

router = APIRouter(prefix="/files", tags=["files"])

ENTITY_MODELS = {"inspection": Inspection, "defect": Defect, "project": Project}


def _check_entity(db: Session, entity_type: str, entity_id: str) -> None:
    model = ENTITY_MODELS.get(entity_type)
    if model is not None and db.get(model, entity_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{entity_type} nicht gefunden")


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    kind: str = Form("photo"),
    field_id: str | None = Form(None),
    sha256: str | None = Form(None),
    captured_at: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    ip: str | None = Depends(get_client_ip),
):
    if kind not in ("photo", "document", "signature"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannte Datei-Kategorie")
    _check_entity(db, entity_type, entity_id)

    content = await file.read(settings.max_upload_bytes + 1)
    declared = file.content_type if file.content_type != "application/octet-stream" else None
    filename = file.filename or ""
    mime = storage.validate_upload(content=content, declared_mime=declared, filename=filename)

    attachment_id = new_uuid()
    ext = storage.ALLOWED_MIME[mime]
    rel_path, server_hash = storage.save_attachment_file(
        content=content, kind=kind, attachment_id=attachment_id, ext=ext
    )
    client_hash = (sha256 or "").lower()
    if client_hash and client_hash != server_hash:
        try:
            (settings.storage_dir / rel_path).unlink()
        except OSError:
            pass
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            {"message": "Pruefsumme stimmt nicht ueberein", "server_sha256": server_hash},
        )

    attachment = Attachment(
        id=attachment_id,
        kind=kind,
        entity_type=entity_type,
        entity_id=entity_id,
        field_id=field_id[:64] if field_id else None,
        filename=filename or f"{attachment_id}.{ext}",
        mime_type=mime,
        size=len(content),
        sha256=server_hash,
        storage_path=rel_path,
        uploaded_by=user.id,
        device_created_at=parse_ts(captured_at),
    )
    db.add(attachment)
    db.commit()
    audit.record(
        action="FILE_UPLOADED",
        user=user,
        entity="attachment",
        entity_id=attachment.id,
        ip=ip,
        after={
            "kind": kind,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "size": len(content),
            "mime_type": mime,
        },
    )
    return serialize_attachment(attachment)


@router.get("")
def list_attachments(
    entity_type: str,
    entity_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("documents.read")),
):
    rows = (
        db.query(Attachment)
        .filter(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
        .order_by(Attachment.created_at.desc())
        .all()
    )
    return [serialize_attachment(a) for a in rows]


@router.get("/{attachment_id}")
def download_file(
    attachment_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("documents.read")),
):
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datei nicht gefunden")
    path = Path(storage.absolute_path(attachment.storage_path))
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datei fehlt im Speicher")
    quoted = quote(attachment.filename)
    return FileResponse(
        path,
        media_type=attachment.mime_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "X-Content-Type-Options": "nosniff",
        },
    )

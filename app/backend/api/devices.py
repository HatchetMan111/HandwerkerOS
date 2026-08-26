from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.device import Device
from app.backend.models.user import User
from app.backend.services import audit
from app.backend.services.serializers import serialize_device

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("")
def list_devices(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("devices.manage")),
):
    devices = db.query(Device).order_by(Device.last_seen.desc()).all()
    return [serialize_device(d) for d in devices]


@router.post("/{device_id}/disable")
def disable_device(
    device_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("devices.manage")),
    ip: str | None = Depends(get_client_ip),
):
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geraet nicht gefunden")
    device.status = "disabled"
    db.commit()
    audit.record(
        action="DEVICE_DISABLED",
        user=actor,
        entity="device",
        entity_id=device.id,
        ip=ip,
        before={"status": "active"},
        after={"status": "disabled"},
    )
    return serialize_device(device)


@router.post("/{device_id}/enable")
def enable_device(
    device_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("devices.manage")),
    ip: str | None = Depends(get_client_ip),
):
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geraet nicht gefunden")
    device.status = "active"
    db.commit()
    audit.record(
        action="DEVICE_ENABLED",
        user=actor,
        entity="device",
        entity_id=device.id,
        ip=ip,
        before={"status": "disabled"},
        after={"status": "active"},
    )
    return serialize_device(device)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    device_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("devices.manage")),
    ip: str | None = Depends(get_client_ip),
):
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geraet nicht gefunden")
    audit.record(
        action="DEVICE_REVOKED",
        user=actor,
        entity="device",
        entity_id=device.id,
        ip=ip,
        detail={"name": device.name},
    )
    db.delete(device)
    db.commit()

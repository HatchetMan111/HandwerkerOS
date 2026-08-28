from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.backend.api.auth import validate_login_identifier
from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.user import ROLE_PERMISSIONS, User
from app.backend.security import hash_password
from app.backend.services import audit
from app.backend.services.serializers import serialize_user

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _check_login(cls, value: str) -> str:
        return validate_login_identifier(value)
    name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: str = "worker"


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


def _validate_role(role: str) -> None:
    if role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unbekannte Rolle. Gueltig: {sorted(ROLE_PERMISSIONS)}",
        )


@router.get("")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_permission("users.read"))):
    users = db.query(User).order_by(User.name).all()
    return [serialize_user(u) for u in users]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.manage")),
    ip: str | None = Depends(get_client_ip),
):
    _validate_role(body.role)
    existing = db.query(User).filter(func.lower(User.email) == body.email.lower()).first()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "E-Mail bereits registriert")
    user = User(
        email=body.email.lower(),
        name=body.name,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    audit.record(
        action="USER_CREATED",
        user=actor,
        entity="user",
        entity_id=user.id,
        ip=ip,
        after={"email": user.email, "role": user.role},
    )
    return serialize_user(user)


@router.patch("/{user_id}")
def update_user(
    user_id: str,
    body: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.manage")),
    ip: str | None = Depends(get_client_ip),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Benutzer nicht gefunden")
    before = {"name": user.name, "role": user.role, "is_active": user.is_active}
    changes: dict = {}
    if body.name is not None:
        user.name = body.name
        changes["name"] = body.name
    if body.role is not None:
        _validate_role(body.role)
        user.role = body.role
        changes["role"] = body.role
    if body.is_active is not None:
        if user.id == actor.id and body.is_active is False:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Eigenes Konto kann nicht deaktiviert werden",
            )
        user.is_active = body.is_active
        changes["is_active"] = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        changes["password"] = "changed"
    db.commit()
    audit.record(
        action="USER_UPDATED",
        user=actor,
        entity="user",
        entity_id=user.id,
        ip=ip,
        before=before,
        after={**before, **changes},
    )
    return serialize_user(user)

import re
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, get_current_user
from app.backend.db import get_db
from app.backend.models.user import ROLE_PERMISSIONS, User
from app.backend.security import create_token, verify_password
from app.backend.services import audit
from app.backend.services.serializers import serialize_user

LOGIN_PATTERN = re.compile(r"^[^@\s]+(@[^@\s]+\.[^@\s]+)?$")


def validate_login_identifier(value: str) -> str:
    value = value.lower().strip()
    if not LOGIN_PATTERN.match(value) or len(value) < 3 or len(value) > 255:
        raise ValueError("Kennung: 3-255 Zeichen, keine Leerzeichen (Name oder E-Mail)")
    return value


def validate_email(value: str) -> str:
    return validate_login_identifier(value)


router = APIRouter(prefix="/auth", tags=["auth"])

_FAILED: dict[str, list[float]] = {}
_LOCKED_UNTIL: dict[str, float] = {}


class LoginIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _check_login(cls, value: str) -> str:
        return validate_login_identifier(value)
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db), ip: str | None = Depends(get_client_ip)):
    from app.backend.config import settings

    email = body.email.lower().strip()
    now = time.time()
    locked_until = _LOCKED_UNTIL.get(email, 0.0)
    if now < locked_until:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Konto temporaer gesperrt, bitte spaeter erneut versuchen",
        )

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None:
        user = (
            db.query(User)
            .filter(func.lower(User.name) == email)
            .order_by(User.created_at)
            .first()
        )
    valid = (
        user is not None
        and user.is_active
        and verify_password(body.password, user.password_hash)
    )
    if not valid:
        fails = [t for t in _FAILED.get(email, []) if now - t < settings.lockout_seconds]
        fails.append(now)
        _FAILED[email] = fails
        if len(fails) >= settings.lockout_after_fails:
            _LOCKED_UNTIL[email] = now + settings.lockout_seconds
            _FAILED.pop(email, None)
        audit.record(
            action="AUTH_LOGIN_FAILED",
            entity="user",
            entity_id=str(user.id) if user else None,
            username=email,
            ip=ip,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-Mail oder Passwort falsch")

    _FAILED.pop(email, None)
    _LOCKED_UNTIL.pop(email, None)
    audit.record(action="AUTH_LOGIN_SUCCESS", user=user, entity="user", entity_id=user.id, ip=ip)
    return {
        "access_token": create_token(user.id),
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    profile = serialize_user(user)
    profile["available_roles"] = sorted(ROLE_PERMISSIONS.keys())
    return profile

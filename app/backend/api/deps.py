from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.backend.db import get_db
from app.backend.models.user import User
from app.backend.security import verify_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentifizierung erforderlich")
    user_id = verify_token(credentials.credentials)
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Benutzer nicht gefunden oder inaktiv")
    return user


def require_permission(permission: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if not user.has_permission(permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Berechtigung fehlt: {permission}"
            )
        return user

    return checker


def get_client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def get_device_id(request: Request) -> str | None:
    device_id = request.headers.get("X-Device-Id")
    return device_id[:64] if device_id else None


def current_user_safe(user: User = Depends(get_current_user)) -> Any:
    return user

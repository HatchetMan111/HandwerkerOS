import logging
import os
import sys

from sqlalchemy.orm import Session as DBSession

from app.backend.config import settings
from app.backend.db import SessionLocal
from app.backend.models.user import User
from app.backend.security import hash_password

logger = logging.getLogger("handwerkeros.bootstrap")

DEFAULT_PASSWORD = "admin"
USAGE = (
    "Nutzung: python -m app.backend.set_admin_password [email] [passwort] "
    "(oder Umgebungsvariable HANDWERK_NEW_PASSWORD)"
)


def _find_user(db: DBSession, email: str) -> User | None:
    for user in db.query(User).all():
        if user.email.lower() == email.lower():
            return user
    return None


def set_password(email: str | None = None, password: str | None = None) -> None:
    target_email = (email or settings.admin_email or "").strip()
    new_password = password or os.environ.get("HANDWERK_NEW_PASSWORD") or ""
    if len(new_password) < 4:
        raise SystemExit(f"Passwort zu kurz (min. 4 Zeichen). {USAGE}")
    with SessionLocal() as db:
        user = _find_user(db, target_email)
        if user is None:
            raise SystemExit(f"Benutzer '{target_email}' nicht gefunden.")
        user.password_hash = hash_password(new_password)
        db.commit()
        print(f"Passwort fuer {user.email} gesetzt.")


def ensure_bootstrap() -> None:
    with SessionLocal() as db:
        if db.query(User).count() > 0:
            return
        env_password = settings.admin_password
        password = env_password or DEFAULT_PASSWORD
        origin = (
            "aus Umgebungsvariable HANDWERK_ADMIN_PASSWORD"
            if env_password
            else "STANDARD 'admin' - BITTE SOFORT IM ADMIN-BEREICH AENDERN"
        )
        admin = User(
            email=(settings.admin_email or "admin@handwerkeros.local").lower(),
            name="Administrator",
            role="admin",
            password_hash=hash_password(password),
        )
        db.add(admin)
        db.commit()
        logger.warning(
            "Bootstrap-Admin erstellt: %s / Passwort: %s (%s)",
            admin.email,
            "***" if env_password else password,
            origin,
        )


if __name__ == "__main__":
    args = sys.argv[1:]
    set_password(args[0] if args else None, args[1] if len(args) > 1 else None)

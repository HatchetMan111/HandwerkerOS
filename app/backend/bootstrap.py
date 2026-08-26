import logging

from app.backend.config import settings
from app.backend.db import SessionLocal
from app.backend.models.user import User
from app.backend.security import hash_password

logger = logging.getLogger("handwerkeros.bootstrap")


def ensure_bootstrap() -> None:
    with SessionLocal() as db:
        count = db.query(User).count()
        if count > 0:
            return
        password = settings.admin_password
        origin = "Umgebungsvariable HANDWERK_ADMIN_PASSWORD"
        if not password:
            import secrets

            password = secrets.token_urlsafe(12)
            origin = "zufaellig generiert"
        admin = User(
            email=settings.admin_email.lower(),
            name="Administrator",
            role="admin",
            password_hash=hash_password(password),
        )
        db.add(admin)
        db.commit()
        logger.warning(
            "Bootstrap-Admin erstellt: %s / Passwort: %s (%s)",
            admin.email,
            password if not settings.admin_password else "(aus Umgebung)",
            origin,
        )

from fastapi import APIRouter
from sqlalchemy import text

from app.backend.config import settings
from app.backend.db import engine

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_ok = True
    except Exception:
        database_ok = False
    body = {
        "status": "ok" if database_ok else "degraded",
        "database": database_ok,
        "version": settings.version,
    }
    return body


@router.get("/version")
def version():
    return {"name": settings.app_name, "version": settings.version}

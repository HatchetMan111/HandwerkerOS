from fastapi.testclient import TestClient

from app.backend.config import settings
from app.backend.db import SessionLocal
from app.backend.models.user import User
from app.backend.set_admin_password import ensure_bootstrap, set_password


def _delete_all_users() -> None:
    with SessionLocal() as db:
        db.query(User).delete()
        db.commit()


def test_default_admin_credentials_and_reset_tool(client: TestClient):
    original = settings.admin_password
    settings.admin_password = ""
    try:
        _delete_all_users()
        ensure_bootstrap()

        login = client.post(
            "/api/auth/login",
            json={"email": "admin@handwerkeros.local", "password": "admin"},
        )
        assert login.status_code == 200

        wrong = client.post(
            "/api/auth/login",
            json={"email": "admin@handwerkeros.local", "password": "nicht-admin"},
        )
        assert wrong.status_code == 401

        ensure_bootstrap()
        with SessionLocal() as db:
            assert db.query(User).count() == 1

        set_password(None, "brand-neues-passwort-123")
        old_login = client.post(
            "/api/auth/login",
            json={"email": "admin@handwerkeros.local", "password": "admin"},
        )
        assert old_login.status_code == 401
        new_login = client.post(
            "/api/auth/login",
            json={"email": "admin@handwerkeros.local", "password": "brand-neues-passwort-123"},
        )
        assert new_login.status_code == 200
    finally:
        settings.admin_password = original

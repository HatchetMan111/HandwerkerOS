import os  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP = tempfile.mkdtemp(prefix="handwerkeros-test-")
os.environ["HANDWERK_DATA_DIR"] = os.path.join(_TMP, "data")
os.environ["HANDWERK_DB_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["HANDWERK_STORAGE_DIR"] = os.path.join(_TMP, "files")
os.environ["HANDWERK_TOKEN_SECRET"] = "test-secret-key"
os.environ["HANDWERK_ADMIN_EMAIL"] = "admin@test.local"
os.environ["HANDWERK_ADMIN_PASSWORD"] = "admin-secret-1"
os.environ["HANDWERK_MAX_UPLOAD_MB"] = "2"

from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.backend.main import app as fastapi_app  # noqa: E402

ADMIN_EMAIL = os.environ["HANDWERK_ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["HANDWERK_ADMIN_PASSWORD"]
WORKER_PASSWORD = "worker-pass-123"
VIEWER_PASSWORD = "viewer-pass-123"

SAMPLE_SCHEMA = {
    "sections": [
        {
            "id": "allgemein",
            "title": "Allgemein",
            "fields": [
                {"id": "baustelle", "type": "text", "label": "Baustelle", "required": True},
                {"id": "datum", "type": "date", "label": "Datum", "required": True},
            ],
        },
        {
            "id": "pruefung",
            "title": "Pruefung",
            "fields": [
                {
                    "id": "fluchtwege",
                    "type": "yes_no",
                    "label": "Sind Fluchtwege frei?",
                    "required": True,
                },
                {"id": "absicherung", "type": "yes_no_na", "label": "Absperrungen vorhanden?"},
                {"id": "bemerkung", "type": "textarea", "label": "Bemerkungen"},
            ],
        },
        {
            "id": "abschluss",
            "title": "Abschluss",
            "fields": [
                {
                    "id": "unterschrift",
                    "type": "signature",
                    "label": "Unterschrift Kunde",
                    "required": True,
                }
            ],
        },
    ]
}


@pytest.fixture(scope="session")
def client():
    with TestClient(fastapi_app) as test_client:
        yield test_client


def login(client: TestClient, email: str, password: str) -> dict:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin_headers(client):
    return login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture()
def seed(client, admin_headers):
    from tests.helpers import create_seed_data

    return create_seed_data(client, admin_headers)


@pytest.fixture()
def sample_schema():
    return SAMPLE_SCHEMA


__all__ = [
    "login",
    "admin_headers",
    "seed",
    "sample_schema",
    "client",
    "SAMPLE_SCHEMA",
    "SimpleNamespace",
]

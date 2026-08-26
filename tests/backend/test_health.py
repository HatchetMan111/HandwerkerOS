
from app.backend.config import REPO_ROOT, settings


def _version_file() -> str:
    return (REPO_ROOT / "VERSION").read_text().strip()


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version_matches_version_file(client):
    response = client.get("/version")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "HandwerkerOS"
    assert body["version"] == settings.version
    assert body["version"] == _version_file()
    assert body["version"].count(".") == 2


def test_ready_checks_database(client):
    response = client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["database"] is True
    assert body["status"] == "ok"


def test_spa_fallback_when_frontend_not_built(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "HandwerkerOS" in response.text


def test_unknown_api_route_returns_404_json(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404

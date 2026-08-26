
from fastapi.testclient import TestClient

from tests.helpers import rand_suffix


def test_viewer_cannot_create_customer(client: TestClient, seed):
    response = client.post(
        "/api/customers", json={"name": "Verboten GmbH"}, headers=seed.viewer_headers
    )
    assert response.status_code == 403


def test_worker_cannot_manage_users(client: TestClient, seed):
    response = client.get("/api/users", headers=seed.worker_headers)
    assert response.status_code == 403


def test_viewer_can_read_projects(client: TestClient, seed):
    response = client.get("/api/projects", headers=seed.viewer_headers)
    assert response.status_code == 200


def test_admin_can_create_customer(client: TestClient, seed):
    name = f"Kunde {rand_suffix()}"
    response = client.post("/api/customers", json={"name": name}, headers=seed.admin_headers)
    assert response.status_code == 201
    assert response.json()["name"] == name


def test_duplicate_email_conflict(client: TestClient, seed):
    response = client.post(
        "/api/users",
        json={
            "email": seed.worker_email.upper(),
            "name": "Doppelt",
            "password": "passwort-123",
            "role": "worker",
        },
        headers=seed.admin_headers,
    )
    assert response.status_code == 409


def test_invalid_role_rejected(client: TestClient, seed):
    response = client.post(
        "/api/users",
        json={
            "email": f"x-{rand_suffix()}@test.local",
            "name": "Falsche Rolle",
            "password": "passwort-123",
            "role": "superadmin",
        },
        headers=seed.admin_headers,
    )
    assert response.status_code == 422


def test_short_password_rejected(client: TestClient, seed):
    response = client.post(
        "/api/users",
        json={
            "email": f"k-{rand_suffix()}@test.local",
            "name": "Kurz Pass",
            "password": "kurz",
            "role": "worker",
        },
        headers=seed.admin_headers,
    )
    assert response.status_code == 422


def test_device_listing_requires_permission(client: TestClient, seed):
    assert client.get("/api/devices", headers=seed.worker_headers).status_code == 403
    listing = client.get("/api/devices", headers=seed.admin_headers)
    assert listing.status_code == 200

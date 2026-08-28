import uuid

from fastapi.testclient import TestClient

from tests.conftest import ADMIN_EMAIL


def test_login_success_returns_token_and_profile(client: TestClient, admin_headers):
    me = client.get("/api/auth/me", headers=admin_headers)
    assert me.status_code == 200
    profile = me.json()
    assert profile["email"] == ADMIN_EMAIL
    assert profile["role"] == "admin"
    assert "users.manage" in profile["permissions"]


def test_login_wrong_password_rejected(client: TestClient):
    response = client.post(
        "/api/auth/login", json={"email": ADMIN_EMAIL, "password": "falsch-guess-1"}
    )
    assert response.status_code == 401


def test_login_unknown_user_rejected(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": f"niemand-{uuid.uuid4().hex[:6]}@test.local", "password": "egal-1234"},
    )
    assert response.status_code == 401


def test_lockout_after_repeated_failures(client: TestClient, seed):
    email = seed.worker_email
    correct = "worker-pass-123"
    for attempt in range(4):
        response = client.post(
            "/api/auth/login", json={"email": email, "password": f"falsch-{attempt}"}
        )
        assert response.status_code == 401
    fifth = client.post("/api/auth/login", json={"email": email, "password": "falsch-endgueltig"})
    assert fifth.status_code == 401
    locked = client.post("/api/auth/login", json={"email": email, "password": correct})
    assert locked.status_code == 429


def test_me_requires_token(client: TestClient):
    assert client.get("/api/auth/me").status_code == 401


def test_me_rejects_garbage_token(client: TestClient):
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
    assert response.status_code == 401


def test_deactivated_user_cannot_login(client: TestClient, admin_headers):
    suffix = uuid.uuid4().hex[:8]
    email = f"temp-{suffix}@test.local"
    created = client.post(
        "/api/users",
        json={"email": email, "name": "Temp User", "password": "passwort-123", "role": "viewer"},
        headers=admin_headers,
    )
    assert created.status_code == 201
    user_id = created.json()["id"]
    deactivated = client.patch(
        f"/api/users/{user_id}", json={"is_active": False}, headers=admin_headers
    )
    assert deactivated.status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": email, "password": "passwort-123"}
    ).status_code == 401


def test_login_with_plain_username(client: TestClient, admin_headers):
    suffix = uuid.uuid4().hex[:8]
    created = client.post(
        "/api/users",
        json={
            "email": f"monteur{suffix}",
            "name": "Nur Benutzername",
            "password": "geheim-1234",
            "role": "worker",
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text

    login = client.post(
        "/api/auth/login", json={"email": f"monteur{suffix}", "password": "geheim-1234"}
    )
    assert login.status_code == 200

    spaces = client.post(
        "/api/users",
        json={
            "email": "mit leer",
            "name": "X",
            "password": "geheim-1234",
            "role": "worker",
        },
        headers=admin_headers,
    )
    assert spaces.status_code == 422

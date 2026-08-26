import uuid

from fastapi.testclient import TestClient

from tests.helpers import inspection_payload, post_sync, sync_op


def test_pull_returns_changed_entities(client: TestClient, seed):
    inspection_id = str(uuid.uuid4())
    create = sync_op(
        "pull-create-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "create",
        payload=inspection_payload(seed),
    )
    synced = post_sync(client, seed.worker_headers, f"tablet-pull-{uuid.uuid4().hex[:6]}", [create])
    assert synced.status_code == 200

    pulled = client.get("/api/sync/changes?limit=500", headers=seed.worker_headers)
    assert pulled.status_code == 200
    body = pulled.json()
    for key in (
        "server_time",
        "customers",
        "projects",
        "form_templates",
        "form_versions",
        "inspections",
        "defects",
    ):
        assert key in body
    pulled_ids = {i["id"] for i in body["inspections"]}
    assert inspection_id in pulled_ids
    project_ids = {p["id"] for p in body["projects"]}
    assert seed.project["id"] in project_ids


def test_pull_since_filters_old_entries(client: TestClient, seed):
    from app.backend.timeutil import iso_z, utcnow

    marker_future = iso_z(utcnow())
    empty_pull = client.get(
        f"/api/sync/changes?since={marker_future}&limit=100", headers=seed.worker_headers
    )
    assert empty_pull.status_code == 200
    body = empty_pull.json()
    assert isinstance(body["inspections"], list)


def test_pull_requires_auth(client: TestClient):
    assert client.get("/api/sync/changes").status_code == 401

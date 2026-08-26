from fastapi.testclient import TestClient

from tests.helpers import complete_data


def test_create_template_with_initial_version(client: TestClient, seed):
    assert seed.template["latest_version"] == 1
    assert seed.template["versions"][0]["version"] == 1
    sections = seed.template["versions"][0]["schema"]["sections"]
    assert len(sections) == 3


def test_invalid_schema_rejected_with_field_errors(client: TestClient, admin_headers):
    bad_schema = {
        "sections": [
            {
                "id": "s1",
                "title": "S1",
                "fields": [
                    {"id": "f1", "type": "zauberfeld", "label": "X"},
                    {"id": "f1", "type": "text", "label": "Duplikat"},
                    {"id": "", "type": "text", "label": "Ohne ID"},
                ],
            }
        ]
    }
    response = client.post(
        "/api/forms/templates", json={"name": "Kaputt", "schema": bad_schema}, headers=admin_headers
    )
    assert response.status_code == 422
    errors = response.json()["detail"]["schema_errors"]
    assert any("type" in e for e in errors)
    assert any("dupliziert" in e for e in errors)


def test_new_form_version_increments(client: TestClient, seed, admin_headers):
    schema_v2 = {
        "sections": [
            {
                "id": "allgemein",
                "title": "Allgemein V2",
                "fields": [{"id": "baustelle", "type": "text", "label": "Baustelle"}],
            }
        ]
    }
    created = client.post(
        f"/api/forms/templates/{seed.template['id']}/versions",
        json={"schema": schema_v2},
        headers=admin_headers,
    )
    assert created.status_code == 201
    assert created.json()["version"] == 2

    fetched = client.get(f"/api/forms/templates/{seed.template['id']}", headers=admin_headers)
    versions = fetched.json()["versions"]
    assert [v["version"] for v in versions] == [1, 2]


def test_completed_inspection_pins_form_version(client: TestClient, seed, worker_headers=None):
    headers = worker_headers or seed.worker_headers
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": complete_data(),
        },
        headers=headers,
    )
    assert created.status_code == 201
    inspection_id = created.json()["id"]

    completed = client.post(f"/api/inspections/{inspection_id}/complete", json={}, headers=headers)
    assert completed.status_code == 200
    body = completed.json()
    assert body["status"] == "completed"
    assert body["form_version_id"] == seed.version_id
    assert body["completed_at"] is not None


def test_complete_blocks_on_missing_required_fields(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": {"bemerkung": "hallo"},
        },
        headers=seed.worker_headers,
    )
    inspection_id = created.json()["id"]
    completed = client.post(
        f"/api/inspections/{inspection_id}/complete", json={}, headers=seed.worker_headers
    )
    assert completed.status_code == 422
    missing = completed.json()["detail"]["missing_required"]
    missing_ids = {m["id"] for m in missing}
    assert {"baustelle", "datum", "fluchtwege", "unterschrift"} <= missing_ids


def test_edit_after_complete_is_locked(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": complete_data(),
        },
        headers=seed.worker_headers,
    )
    inspection_id = created.json()["id"]
    completed = client.post(
        f"/api/inspections/{inspection_id}/complete", json={}, headers=seed.worker_headers
    )
    assert completed.status_code == 200

    locked = client.patch(
        f"/api/inspections/{inspection_id}",
        json={"data": {"fluchtwege": "nein"}, "base_version": 2},
        headers=seed.worker_headers,
    )
    assert locked.status_code == 409
    assert "gesperrt" in str(locked.json()["detail"])


def test_optimistic_lock_on_rest_update(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": {"bemerkung": "alt"},
        },
        headers=seed.worker_headers,
    ).json()

    stale = client.patch(
        f"/api/inspections/{created['id']}",
        json={"data": {"bemerkung": "veraltet"}, "base_version": 99},
        headers=seed.worker_headers,
    )
    assert stale.status_code == 409
    conflict = stale.json()["detail"]
    assert conflict["server_version"] == 1
    assert conflict["client_base_version"] == 99
    assert "server_state" in conflict

    fresh = client.patch(
        f"/api/inspections/{created['id']}",
        json={"data": {"bemerkung": "aktuell"}, "base_version": 1},
        headers=seed.worker_headers,
    )
    assert fresh.status_code == 200
    assert fresh.json()["version"] == 2


def test_illegal_transition_rejected(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": complete_data(),
        },
        headers=seed.worker_headers,
    ).json()
    response = client.post(
        f"/api/inspections/{created['id']}/transition",
        json={"status": "archived"},
        headers=seed.admin_headers,
    )
    assert response.status_code == 409

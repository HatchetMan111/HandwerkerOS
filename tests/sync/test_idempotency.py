import uuid

from fastapi.testclient import TestClient

from app.backend.db import SessionLocal
from app.backend.models.inspection import Inspection
from tests.helpers import inspection_payload, post_sync, sync_op


def get_row(entity_id: str) -> Inspection | None:
    with SessionLocal() as session:
        return session.get(Inspection, entity_id)


def test_create_applied_once_then_replay_is_duplicate(client: TestClient, seed):
    device = f"tablet-idem-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    operation = sync_op(
        "op-create-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "create",
        payload=inspection_payload(seed),
    )

    first = post_sync(client, seed.worker_headers, device, [operation])
    assert first.status_code == 200, first.text
    result = first.json()["results"][0]
    assert result["status"] == "applied"
    assert result["server_version"] == 1
    assert result["replayed"] is False

    second = post_sync(client, seed.worker_headers, device, [operation])
    result2 = second.json()["results"][0]
    assert result2["status"] == "applied"
    assert result2["server_version"] == 1
    assert result2["replayed"] is True

    with SessionLocal() as session:
        count = (
            session.query(Inspection).filter(Inspection.id == inspection_id).count()
        )
    assert count == 1


def test_create_against_existing_entity_reports_duplicate(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": {},
        },
        headers=seed.worker_headers,
    ).json()
    response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-dup-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "op-dup-" + uuid.uuid4().hex[:16],
                "inspection",
                created["id"],
                "create",
                payload=inspection_payload(seed),
            )
        ],
    )
    assert response.json()["results"][0]["status"] == "duplicate"


def test_update_chain_is_idempotent(client: TestClient, seed):
    device = f"tablet-chain-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    create_op = sync_op(
        "op-c-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "create",
        payload=inspection_payload(seed),
    )
    update_op = sync_op(
        "op-u-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        payload={"data": {"fluchtwege": "ja", "bemerkung": "erste Pruefung"}},
    )

    first = post_sync(client, seed.worker_headers, device, [create_op, update_op])
    statuses = [r["status"] for r in first.json()["results"]]
    assert statuses == ["applied", "applied"]

    replay = post_sync(client, seed.worker_headers, device, [update_op])
    replayed_result = replay.json()["results"][0]
    assert replayed_result["status"] == "applied"
    assert replayed_result["replayed"] is True
    assert replayed_result["server_version"] == 2

    row = get_row(inspection_id)
    assert row is not None and row.version == 2
    assert row.data_json["bemerkung"] == "erste Pruefung"


def test_update_without_base_version_rejected(client: TestClient, seed):
    inspection_id = str(uuid.uuid4())
    response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-nobase-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "op-bv-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "update",
                payload={"data": {"fluchtwege": "ja"}},
            )
        ],
    )
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"] in ("base_version_required", "not_found")


def test_delete_operation_rejected(client: TestClient, seed):
    inspection_id = str(uuid.uuid4())
    create_response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-del-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "op-dc-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "create",
                payload=inspection_payload(seed),
            )
        ],
    )
    assert create_response.json()["results"][0]["status"] == "applied"

    delete_response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-del-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "op-dd-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "delete",
            )
        ],
    )
    result = delete_response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"] == "delete_not_supported"
    assert get_row(inspection_id) is not None


def test_unknown_project_rejected(client: TestClient, seed):
    payload = inspection_payload(seed)
    payload["project_id"] = str(uuid.uuid4())
    response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-unknown-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "op-unk-" + uuid.uuid4().hex[:16],
                "inspection",
                str(uuid.uuid4()),
                "create",
                payload=payload,
            )
        ],
    )
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]


def test_disabled_device_blocked_entirely(client: TestClient, seed, admin_headers):
    device = f"tablet-kill-{uuid.uuid4().hex[:6]}"
    ok = post_sync(client, seed.worker_headers, device, [])
    assert ok.status_code == 200

    devices = client.get("/api/devices", headers=admin_headers).json()
    target = next(d for d in devices if d["id"] == device)
    disabled = client.post(f"/api/devices/{device}/disable", json={}, headers=admin_headers)
    assert disabled.status_code == 200

    blocked = post_sync(client, seed.worker_headers, device, [])
    assert blocked.status_code == 403
    assert target["name"] == "Test-Tablet"

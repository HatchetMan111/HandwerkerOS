import uuid

from fastapi.testclient import TestClient

from app.backend.config import settings
from tests.helpers import inspection_payload, post_sync, sync_op, ts_offset


def _setup(client: TestClient, seed) -> tuple[str, str]:
    device = f"tablet-conf-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    create = sync_op(
        "conf-create-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "create",
        payload=inspection_payload(seed),
    )
    response = post_sync(client, seed.worker_headers, device, [create])
    assert response.json()["results"][0]["status"] == "applied"
    return device, inspection_id


def test_stale_update_produces_conflict_with_server_state(client: TestClient, seed):
    _, inspection_id = _setup(client, seed)
    newer = sync_op(
        "conf-win-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(0),
        payload={"data": {"fluchtwege": "ja"}},
    )
    applied = post_sync(client, seed.worker_headers, f"tablet-a-{uuid.uuid4().hex[:6]}", [newer])
    assert applied.json()["results"][0]["server_version"] == 2

    stale = sync_op(
        "conf-stale-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(-30),
        payload={"data": {"fluchtwege": "nein", "bemerkung": "veralteter Client"}},
    )
    conflict_response = post_sync(
        client, seed.worker_headers, f"tablet-b-{uuid.uuid4().hex[:6]}", [stale]
    )
    result = conflict_response.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["server_version"] == 2
    assert result["error"] is None
    conflict = result["conflict"]
    assert conflict["client_base_version"] == 1
    assert conflict["server_version"] == 2
    assert conflict["server_state"]["data"]["fluchtwege"] == "ja"

    from app.backend.db import SessionLocal
    from app.backend.models.inspection import Inspection

    with SessionLocal() as session:
        row = session.get(Inspection, inspection_id)
        assert row.version == 2
        assert row.data_json.get("bemerkung") is None


def test_lww_disabled_by_default(client: TestClient, seed, monkeypatch):
    monkeypatch.setattr(settings, "sync_allow_lww", False)
    _, inspection_id = _setup(client, seed)

    advance = sync_op(
        "lww-adv-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(0),
        payload={"data": {"fluchtwege": "ja"}},
    )
    advanced = post_sync(
        client, seed.worker_headers, f"tablet-adv-{uuid.uuid4().hex[:6]}", [advance]
    )
    assert advanced.json()["results"][0]["server_version"] == 2

    op = sync_op(
        "lww-off-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(60),
        payload={"data": {"bemerkung": "sollte nicht gelten"}},
    )
    result = post_sync(
        client, seed.worker_headers, f"tablet-lww0-{uuid.uuid4().hex[:6]}", [op]
    ).json()["results"][0]
    assert result["status"] == "conflict"


def test_lww_resolves_when_enabled_and_client_newer(client: TestClient, seed, monkeypatch):
    monkeypatch.setattr(settings, "sync_allow_lww", True)
    _, inspection_id = _setup(client, seed)

    advance = sync_op(
        "lww-adv2-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(-10),
        payload={"data": {"fluchtwege": "ja"}},
    )
    advanced = post_sync(
        client, seed.worker_headers, f"tablet-adv2-{uuid.uuid4().hex[:6]}", [advance]
    )
    assert advanced.json()["results"][0]["server_version"] == 2

    op = sync_op(
        "lww-new-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(5),
        payload={"data": {"bemerkung": "neuerer Client gewinnt"}},
    )
    result = post_sync(
        client, seed.worker_headers, f"tablet-lww1-{uuid.uuid4().hex[:6]}", [op]
    ).json()["results"][0]
    assert result["status"] == "applied"
    assert result["conflict"] is None

    from app.backend.db import SessionLocal
    from app.backend.models.inspection import Inspection

    with SessionLocal() as session:
        row = session.get(Inspection, inspection_id)
        assert row.version == 3
        assert row.data_json["bemerkung"] == "neuerer Client gewinnt"


def test_lww_still_conflicts_when_client_older(client: TestClient, seed, monkeypatch):
    monkeypatch.setattr(settings, "sync_allow_lww", True)
    _, inspection_id = _setup(client, seed)

    first = sync_op(
        "lww-1st-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(10),
        payload={"data": {"bemerkung": "spaetere Aenderung zuerst gesendet"}},
    )
    assert (
        post_sync(client, seed.worker_headers, f"tablet-l1-{uuid.uuid4().hex[:6]}", [first])
        .json()["results"][0]["status"]
        == "applied"
    )

    older = sync_op(
        "lww-old-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        client_updated_at=ts_offset(-120),
        payload={"data": {"bemerkung": "alte Uhr"}},
    )
    result = post_sync(
        client, seed.worker_headers, f"tablet-l2-{uuid.uuid4().hex[:6]}", [older]
    ).json()["results"][0]
    assert result["status"] == "conflict"


def test_defect_conflict_and_resolution(client: TestClient, seed):
    defect_id = str(uuid.uuid4())
    create = sync_op(
        "def-create-" + uuid.uuid4().hex[:16],
        "defect",
        defect_id,
        "create",
        payload={
            "project_id": seed.project["id"],
            "description": "Lose Schraube am Geruest",
            "priority": "high",
        },
    )
    created = post_sync(client, seed.worker_headers, f"tablet-def-{uuid.uuid4().hex[:6]}", [create])
    assert created.json()["results"][0]["status"] == "applied"

    stale = sync_op(
        "def-stale-" + uuid.uuid4().hex[:16],
        "defect",
        defect_id,
        "update",
        base_version=5,
        payload={"description": "falsche Basis"},
    )
    conflict_result = post_sync(
        client, seed.worker_headers, f"tablet-def2-{uuid.uuid4().hex[:6]}", [stale]
    ).json()["results"][0]
    assert conflict_result["status"] == "conflict"
    assert conflict_result["conflict"]["server_state"]["description"] == "Lose Schraube am Geruest"

    valid = sync_op(
        "def-fix-" + uuid.uuid4().hex[:16],
        "defect",
        defect_id,
        "update",
        base_version=1,
        payload={"status": "resolved"},
    )
    fixed = post_sync(
        client, seed.worker_headers, f"tablet-def3-{uuid.uuid4().hex[:6]}", [valid]
    ).json()["results"][0]
    assert fixed["status"] == "applied"
    assert fixed["server_version"] == 2

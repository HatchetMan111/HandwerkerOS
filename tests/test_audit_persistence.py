import uuid

from fastapi.testclient import TestClient

from app.backend.db import SessionLocal
from app.backend.models.audit import AuditLog
from app.backend.models.customer import Customer
from app.backend.services import audit
from tests.helpers import complete_data, inspection_payload, post_sync, sync_op


def _audit_rows(entity: str, entity_id: str) -> list[AuditLog]:
    with SessionLocal() as session:
        return (
            session.query(AuditLog)
            .filter(AuditLog.entity == entity, AuditLog.entity_id == entity_id)
            .order_by(AuditLog.seq)
            .all()
        )


def test_sync_operations_leave_complete_audit_trail(client: TestClient, seed):
    device = f"tablet-audit-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    create = sync_op(
        "audit-create-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "create",
        payload=inspection_payload(seed),
    )
    update = sync_op(
        "audit-update-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=1,
        payload={"data": {"fluchtwege": "ja", "sicherungskasten_geprueft": "nein"}},
    )
    response = post_sync(client, seed.worker_headers, device, [create, update])
    statuses = [r["status"] for r in response.json()["results"]]
    assert statuses == ["applied", "applied"]

    rows = _audit_rows("inspection", inspection_id)
    actions = [row.action for row in rows]
    assert "INSPECTION_CREATED" in actions
    assert "INSPECTION_UPDATED" in actions

    update_row = next(row for row in rows if row.action == "INSPECTION_UPDATED")
    assert update_row.before["version"] == 1
    assert update_row.after["version"] == 2
    assert update_row.device_id == device
    assert update_row.username


def test_field_change_captures_before_and_after(client: TestClient, seed):
    device = f"tablet-field-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    post_sync(
        client,
        seed.worker_headers,
        device,
        [
            sync_op(
                "fld-create-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "create",
                payload=inspection_payload(seed, {"fluchtwege": "ja"}),
            )
        ],
    )
    post_sync(
        client,
        seed.worker_headers,
        f"tablet-field2-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "fld-update-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "update",
                base_version=1,
                payload={"data": {"fluchtwege": "nein"}},
            )
        ],
    )

    rows = _audit_rows("inspection", inspection_id)
    update_row = rows[-1]
    assert update_row.action == "INSPECTION_UPDATED"
    before_data = update_row.before["data"]
    after_data = update_row.after["data"]
    assert before_data.get("fluchtwege") == "ja"
    assert after_data["fluchtwege"] == "nein"


def test_audit_persisted_after_caller_commit_regression(client: TestClient):
    marker = uuid.uuid4().hex
    with SessionLocal() as session:
        customer = Customer(name=f"Legacy-Pattern {marker}")
        session.add(customer)
        session.commit()

        audit.record(
            action="TEST_LEGACY_PATTERN",
            entity="customer",
            entity_id=customer.id,
            detail={"marker": marker},
        )

    with SessionLocal() as fresh:
        row = (
            fresh.query(AuditLog)
            .filter(AuditLog.action == "TEST_LEGACY_PATTERN")
            .order_by(AuditLog.seq.desc())
            .first()
        )
    assert row is not None, "Audit-Eintrag nach Commit verloren - Bug ist zurueck"
    assert row.detail == {"marker": marker}


def test_rest_update_writes_audit_with_ip_and_device(client: TestClient, seed):
    created = client.post(
        "/api/inspections",
        json={
            "project_id": seed.project["id"],
            "form_template_id": seed.template["id"],
            "form_version_id": seed.version_id,
            "data": complete_data(),
        },
        headers={**seed.worker_headers, "X-Device-Id": "rest-tablet-01"},
    ).json()
    patched = client.patch(
        f"/api/inspections/{created['id']}",
        json={"data": {"bemerkung": "Nachtrag vom Tablet"}, "base_version": 1},
        headers={**seed.worker_headers, "X-Device-Id": "rest-tablet-01"},
    )
    assert patched.status_code == 200

    rows = _audit_rows("inspection", created["id"])
    update_rows = [r for r in rows if r.action == "INSPECTION_UPDATED"]
    assert update_rows
    latest = update_rows[-1]
    assert latest.device_id == "rest-tablet-01"
    assert latest.ip
    assert latest.after["data"]["bemerkung"] == "Nachtrag vom Tablet"


def test_conflict_is_audited(client: TestClient, seed):
    device = f"tablet-ca-{uuid.uuid4().hex[:6]}"
    inspection_id = str(uuid.uuid4())
    post_sync(
        client,
        seed.worker_headers,
        device,
        [
            sync_op(
                "ca-create-" + uuid.uuid4().hex[:16],
                "inspection",
                inspection_id,
                "create",
                payload=inspection_payload(seed),
            )
        ],
    )
    stale = sync_op(
        "ca-stale-" + uuid.uuid4().hex[:16],
        "inspection",
        inspection_id,
        "update",
        base_version=99,
        payload={"data": {"bemerkung": "stale"}},
    )
    conflict_response = post_sync(
        client, seed.worker_headers, f"tablet-cb-{uuid.uuid4().hex[:6]}", [stale]
    )
    assert conflict_response.json()["results"][0]["status"] == "conflict"

    with SessionLocal() as fresh:
        conflict_audits = (
            fresh.query(AuditLog)
            .filter(AuditLog.action == "SYNC_CONFLICT", AuditLog.entity_id == inspection_id)
            .all()
        )
    assert len(conflict_audits) >= 1
    assert conflict_audits[0].detail["server_state"]["version"] == 1


def test_login_failures_are_audited(client: TestClient, seed):
    email = seed.viewer_email
    client.post("/api/auth/login", json={"email": email, "password": "falsch-pass-1"})

    with SessionLocal() as fresh:
        failed = (
            fresh.query(AuditLog)
            .filter(AuditLog.action == "AUTH_LOGIN_FAILED")
            .order_by(AuditLog.seq.desc())
            .first()
        )
    assert failed is not None
    assert failed.ip

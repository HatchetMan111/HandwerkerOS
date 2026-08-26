import uuid

from fastapi.testclient import TestClient

from app.backend.db import SessionLocal
from app.backend.models.timematerial import MaterialUsage, TimeEntry
from tests.helpers import post_sync, sync_op


def _create_project(client: TestClient, seed) -> str:
    return seed.project["id"]


def test_time_entry_sync_idempotent_and_offline_queue(client: TestClient, seed):
    device = f"tablet-time-{uuid.uuid4().hex[:6]}"
    entry_id = str(uuid.uuid4())
    op = sync_op(
        "time-create-" + uuid.uuid4().hex[:16],
        "time_entry",
        entry_id,
        "create",
        payload={
            "project_id": seed.project["id"],
            "work_date": "2026-08-26",
            "hours": 6.5,
            "activity": "Kabelverlegung KG",
        },
    )
    first = post_sync(client, seed.worker_headers, device, [op])
    assert first.json()["results"][0]["status"] == "applied"

    replay = post_sync(client, seed.worker_headers, device, [op])
    result = replay.json()["results"][0]
    assert result["status"] == "applied" and result["replayed"] is True

    with SessionLocal() as session:
        count = session.query(TimeEntry).filter(TimeEntry.id == entry_id).count()
    assert count == 1


def test_time_entry_stale_update_conflicts(client: TestClient, seed):
    device = f"tablet-time2-{uuid.uuid4().hex[:6]}"
    entry_id = str(uuid.uuid4())
    create_op = sync_op(
        "t2-create-" + uuid.uuid4().hex[:16],
        "time_entry",
        entry_id,
        "create",
        payload={"project_id": seed.project["id"], "work_date": "2026-08-26", "hours": 8},
    )
    update_op = sync_op(
        "t2-update-" + uuid.uuid4().hex[:16],
        "time_entry",
        entry_id,
        "update",
        base_version=1,
        payload={"hours": 9.5, "activity": "Nachtrag offline"},
    )
    response = post_sync(client, seed.worker_headers, device, [create_op, update_op])
    statuses = [r["status"] for r in response.json()["results"]]
    assert statuses == ["applied", "applied"]

    stale = sync_op(
        "t2-stale-" + uuid.uuid4().hex[:16],
        "time_entry",
        entry_id,
        "update",
        base_version=1,
        payload={"hours": 3},
    )
    conflict = post_sync(
        client, seed.worker_headers, f"tablet-t3-{uuid.uuid4().hex[:6]}", [stale]
    ).json()["results"][0]
    assert conflict["status"] == "conflict"
    assert conflict["conflict"]["server_state"]["hours"] == 9.5


def test_time_entry_delete_via_sync(client: TestClient, seed):
    device = f"tablet-time4-{uuid.uuid4().hex[:6]}"
    entry_id = str(uuid.uuid4())
    post_sync(
        client,
        seed.worker_headers,
        device,
        [
            sync_op(
                "t4-create-" + uuid.uuid4().hex[:16],
                "time_entry",
                entry_id,
                "create",
                payload={"project_id": seed.project["id"], "work_date": "2026-08-25", "hours": 2},
            )
        ],
    )
    delete = sync_op(
        "t4-del-" + uuid.uuid4().hex[:16], "time_entry", entry_id, "delete"
    )
    result = post_sync(
        client, seed.worker_headers, f"tablet-t5-{uuid.uuid4().hex[:6]}", [delete]
    ).json()["results"][0]
    assert result["status"] == "applied"
    with SessionLocal() as session:
        assert session.get(TimeEntry, entry_id) is None


def test_material_usage_with_catalog_pricing(client: TestClient, seed):
    item = client.post(
        "/api/materials",
        json={"name": "NYM-J 3x1.5", "unit": "m", "price_cents": 189, "article_number": "NYM15"},
        headers=seed.admin_headers,
    ).json()
    usage_id = str(uuid.uuid4())
    response = post_sync(
        client,
        seed.worker_headers,
        f"tablet-mat-{uuid.uuid4().hex[:6]}",
        [
            sync_op(
                "mat-create-" + uuid.uuid4().hex[:16],
                "material_usage",
                usage_id,
                "create",
                payload={
                    "project_id": seed.project["id"],
                    "material_id": item["id"],
                    "quantity": 85,
                    "work_date": "2026-08-26",
                },
            )
        ],
    ).json()["results"][0]
    assert response["status"] == "applied"

    with SessionLocal() as session:
        usage = session.get(MaterialUsage, usage_id)
        assert usage.name == "NYM-J 3x1.5"
        assert usage.price_cents == 189


def test_approval_flow_permissions(client: TestClient, seed):
    entry = client.post(
        "/api/time/entries",
        json={
            "project_id": seed.project["id"],
            "work_date": "2026-08-26",
            "hours": 7.0,
            "activity": "Zaehlerplatz",
        },
        headers=seed.worker_headers,
    )
    assert entry.status_code == 201
    data = entry.json()

    worker_approve = client.patch(
        f"/api/time/entries/{data['id']}",
        json={"base_version": 1, "status": "approved"},
        headers=seed.worker_headers,
    )
    assert worker_approve.status_code == 403

    admin_approve = client.patch(
        f"/api/time/entries/{data['id']}",
        json={"base_version": 1, "status": "approved"},
        headers=seed.admin_headers,
    )
    assert admin_approve.status_code == 200
    assert admin_approve.json()["status"] == "approved"

    edit_approved = client.patch(
        f"/api/time/entries/{data['id']}",
        json={"base_version": 2, "hours": 5},
        headers=seed.worker_headers,
    )
    assert edit_approved.status_code == 409


def test_invoice_from_approved_time_and_material(client: TestClient, seed):
    entry = client.post(
        "/api/time/entries",
        json={
            "project_id": seed.project["id"],
            "work_date": "2026-08-20",
            "hours": 10.0,
        },
        headers=seed.worker_headers,
    ).json()
    patched = client.patch(
        f"/api/time/entries/{entry['id']}",
        json={"base_version": 1, "status": "approved"},
        headers=seed.admin_headers,
    )
    assert patched.status_code == 200

    preview = client.post(
        "/api/invoices/preview",
        json={"project_id": seed.project["id"], "hourly_rate_cents": 4500, "tax_percent": 19},
        headers=seed.admin_headers,
    ).json()

    labor_line = next(line for line in preview["lines"] if line["type"] == "labor")
    assert labor_line["quantity"] == 10.0
    assert labor_line["total_cents"] == 45000

    invoice = client.post(
        "/api/invoices",
        json={"project_id": seed.project["id"], "hourly_rate_cents": 4500},
        headers=seed.admin_headers,
    ).json()
    import re

    assert re.match(r"^\d{4}-\d{4}$", invoice["number"])
    expected_subtotal = sum(line["total_cents"] for line in invoice["lines"])
    assert invoice["subtotal_cents"] == expected_subtotal
    assert invoice["total_cents"] == int(expected_subtotal * 1.19 // 100) or (
        invoice["vat_cents"] == expected_subtotal * 19 // 100
        and invoice["total_cents"] == expected_subtotal + invoice["vat_cents"]
    )

    final = client.patch(
        f"/api/invoices/{invoice['id']}", json={"status": "final"}, headers=seed.admin_headers
    )
    assert final.status_code == 200
    delete_attempt = client.delete(f"/api/invoices/{invoice['id']}", headers=seed.admin_headers)
    assert delete_attempt.status_code == 409


def test_worker_cannot_approve_or_see_invoices(client: TestClient, seed):
    entries = client.get("/api/time/entries?mine_only=true", headers=seed.worker_headers)
    assert entries.status_code == 200
    invoices = client.get("/api/invoices", headers=seed.worker_headers)
    assert invoices.status_code == 403


def test_pull_includes_new_entities_for_offline(client: TestClient, seed):
    pull = client.get("/api/sync/changes?limit=500", headers=seed.worker_headers).json()
    for key in ("time_entries", "material_usages", "assignments", "materials"):
        assert key in pull

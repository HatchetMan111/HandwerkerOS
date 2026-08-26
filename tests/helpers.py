import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.backend.timeutil import iso_z, utcnow
from tests.conftest import SAMPLE_SCHEMA, VIEWER_PASSWORD, WORKER_PASSWORD, login


def rand_suffix() -> str:
    return uuid.uuid4().hex[:8]


def sync_op(
    operation_id: str,
    entity: str,
    entity_id: str,
    operation: str,
    payload: dict[str, Any] | None = None,
    base_version: int | None = None,
    client_updated_at: str | None = None,
) -> dict[str, Any]:
    op: dict[str, Any] = {
        "operation_id": operation_id,
        "entity": entity,
        "entity_id": entity_id,
        "operation": operation,
    }
    if payload is not None:
        op["payload"] = payload
    if base_version is not None:
        op["base_version"] = base_version
    if client_updated_at is not None:
        op["client_updated_at"] = client_updated_at
    return op


def post_sync(
    client: TestClient,
    headers: dict,
    device_id: str,
    operations: list[dict[str, Any]],
):
    return client.post(
        "/api/sync",
        json={
            "device_id": device_id,
            "device_name": "Test-Tablet",
            "device_platform": "android",
            "operations": operations,
        },
        headers=headers,
    )


def inspection_payload(seed, data_overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    data = {"baustelle": "Müller", "datum": "2026-08-26"}
    if data_overrides:
        data.update(data_overrides)
    return {
        "project_id": seed.project["id"],
        "form_template_id": seed.template["id"],
        "form_version_id": seed.version_id,
        "data": data,
    }


def ts_offset(minutes: int) -> str:
    return iso_z(utcnow() + timedelta(minutes=minutes))


def create_seed_data(client: TestClient, admin_headers: dict) -> Any:
    from types import SimpleNamespace

    suffix = rand_suffix()
    customer = client.post(
        "/api/customers",
        json={"name": f"Müller GmbH {suffix}", "address": "Musterweg 1"},
        headers=admin_headers,
    ).json()
    project = client.post(
        "/api/projects",
        json={
            "name": f"Baustelle Müller {suffix}",
            "customer_id": customer["id"],
            "location": "Hauptstr. 12",
        },
        headers=admin_headers,
    ).json()
    template_response = client.post(
        "/api/forms/templates",
        json={
            "name": f"Baustellenkontrolle Elektro {suffix}",
            "category": "elektro",
            "schema": SAMPLE_SCHEMA,
        },
        headers=admin_headers,
    )
    assert template_response.status_code == 201, template_response.text
    template = template_response.json()
    version_id = template["versions"][0]["id"]

    worker_email = f"monteur-{suffix}@test.local"
    worker_response = client.post(
        "/api/users",
        json={
            "email": worker_email,
            "name": f"Monteur Max {suffix}",
            "password": WORKER_PASSWORD,
            "role": "worker",
        },
        headers=admin_headers,
    )
    assert worker_response.status_code == 201, worker_response.text
    viewer_email = f"leser-{suffix}@test.local"
    viewer_response = client.post(
        "/api/users",
        json={
            "email": viewer_email,
            "name": f"Leser Lisa {suffix}",
            "password": VIEWER_PASSWORD,
            "role": "viewer",
        },
        headers=admin_headers,
    )
    assert viewer_response.status_code == 201, viewer_response.text

    return SimpleNamespace(
        suffix=suffix,
        customer=customer,
        project=project,
        template=template,
        version_id=version_id,
        worker_email=worker_email,
        worker_headers=login(client, worker_email, WORKER_PASSWORD),
        viewer_email=viewer_email,
        viewer_headers=login(client, viewer_email, VIEWER_PASSWORD),
        admin_headers=admin_headers,
    )


def complete_data() -> dict[str, Any]:
    return {
        "baustelle": "Müller",
        "datum": "2026-08-26",
        "fluchtwege": "ja",
        "absicherung": "na",
        "bemerkung": "Alles frei",
        "unterschrift": "data:image/png;base64,PNGDATA",
    }


MIN_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 16


def make_jpeg(size: int = 64) -> bytes:
    return b"\xff\xd8\xff\xe0" + b"\x00" * size

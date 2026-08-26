import hashlib

from fastapi.testclient import TestClient

from tests.helpers import MIN_PNG, complete_data


def _create_inspection(client: TestClient, seed) -> str:
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
    assert created.status_code == 201
    return created.json()["id"]


def test_upload_and_download_roundtrip(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    response = client.post(
        "/api/files",
        files={"file": ("baustelle.png", MIN_PNG, "image/png")},
        data={
            "entity_type": "inspection",
            "entity_id": inspection_id,
            "kind": "photo",
            "field_id": "foto1",
        },
        headers=seed.worker_headers,
    )
    assert response.status_code == 201, response.text
    attachment = response.json()
    assert attachment["mime_type"] == "image/png"
    assert attachment["sha256"] == hashlib.sha256(MIN_PNG).hexdigest()

    download = client.get(attachment["url"], headers=seed.viewer_headers)
    assert download.status_code == 200
    assert download.content == MIN_PNG
    assert "attachment" in download.headers["Content-Disposition"]
    assert download.headers["X-Content-Type-Options"] == "nosniff"


def test_upload_list_by_entity(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    client.post(
        "/api/files",
        files={"file": ("a.png", MIN_PNG, "image/png")},
        data={"entity_type": "inspection", "entity_id": inspection_id},
        headers=seed.worker_headers,
    )
    listing = client.get(
        f"/api/files?entity_type=inspection&entity_id={inspection_id}",
        headers=seed.admin_headers,
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_declared_mime_mismatch_rejected(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    response = client.post(
        "/api/files",
        files={"file": ("fake.txt", MIN_PNG, "text/plain")},
        data={"entity_type": "inspection", "entity_id": inspection_id},
        headers=seed.worker_headers,
    )
    assert response.status_code == 415


def test_unknown_binary_rejected(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    response = client.post(
        "/api/files",
        files={"file": ("blob.bin", b"\x00\x01\x02\x03", "application/octet-stream")},
        data={"entity_type": "inspection", "entity_id": inspection_id},
        headers=seed.worker_headers,
    )
    assert response.status_code == 415


def test_oversize_rejected(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    big_png = MIN_PNG + b"\x00" * (3 * 1024 * 1024)
    response = client.post(
        "/api/files",
        files={"file": ("gross.png", big_png, "image/png")},
        data={"entity_type": "inspection", "entity_id": inspection_id},
        headers=seed.worker_headers,
    )
    assert response.status_code == 413


def test_checksum_mismatch_rejected(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    wrong_hash = hashlib.sha256(b"etwas anderes").hexdigest()
    response = client.post(
        "/api/files",
        files={"file": ("a.png", MIN_PNG, "image/png")},
        data={
            "entity_type": "inspection",
            "entity_id": inspection_id,
            "sha256": wrong_hash,
        },
        headers=seed.worker_headers,
    )
    assert response.status_code == 400


def test_pdf_accepted(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    pdf = b"%PDF-1.4\n..." + b"\x00" * 32
    response = client.post(
        "/api/files",
        files={"file": ("protokoll.pdf", pdf, "application/pdf")},
        data={"entity_type": "inspection", "entity_id": inspection_id, "kind": "document"},
        headers=seed.worker_headers,
    )
    assert response.status_code == 201
    assert response.json()["mime_type"] == "application/pdf"


def test_download_requires_documents_read(client: TestClient, seed):
    inspection_id = _create_inspection(client, seed)
    uploaded = client.post(
        "/api/files",
        files={"file": ("a.png", MIN_PNG, "image/png")},
        data={"entity_type": "inspection", "entity_id": inspection_id},
        headers=seed.worker_headers,
    ).json()
    no_token = client.get(uploaded["url"])
    assert no_token.status_code == 401

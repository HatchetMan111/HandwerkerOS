import hashlib
import re

from fastapi import HTTPException, status

from app.backend.config import settings

ALLOWED_MIME: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}

MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
)

SAFE_FILENAME = re.compile(r"^[A-Za-z0-9._ -]{1,255}$")


def sniff_mime(head: bytes) -> str | None:
    for prefix, mime in MAGIC_SIGNATURES:
        if head.startswith(prefix):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_upload(*, content: bytes, declared_mime: str | None, filename: str) -> str:
    if not filename or not SAFE_FILENAME.match(filename):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Dateiname ungueltig")
    if len(content) == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Datei ist leer")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Datei groesser als {settings.max_upload_mb} MB",
        )
    actual = sniff_mime(content[:16])
    if actual is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Dateityp nicht erkannt")
    if declared_mime and declared_mime != actual:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Deklarierter Typ {declared_mime} passt nicht zum Inhalt ({actual})",
        )
    return actual


def save_attachment_file(
    *, content: bytes, kind: str, attachment_id: str, ext: str
) -> tuple[str, str]:
    kind_dirs = {"photo": "photos", "document": "documents", "signature": "signatures"}
    subdir = kind_dirs.get(kind, "documents")
    rel_dir = f"organizations/default/{subdir}"
    target_dir = settings.storage_dir / rel_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    rel_path = f"{rel_dir}/{attachment_id}.{ext}"
    (settings.storage_dir / rel_path).write_bytes(content)
    sha256 = hashlib.sha256(content).hexdigest()
    return rel_path, sha256


def absolute_path(rel_path: str):
    base = settings.storage_dir.resolve()
    target = (base / rel_path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ungueltiger Pfad")
    return target

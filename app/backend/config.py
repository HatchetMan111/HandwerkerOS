import os
import secrets
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_version() -> str:
    try:
        return (REPO_ROOT / "VERSION").read_text().strip()
    except OSError:
        return "dev"


class Settings:
    def __init__(self) -> None:
        self.app_name = "HandwerkerOS"
        self.version = _read_version()
        self.data_dir = Path(
            os.environ.get("HANDWERK_DATA_DIR", str(REPO_ROOT / "storage" / "data"))
        ).resolve()
        default_db = "sqlite:///" + str(self.data_dir / "handwerkeros.db")
        self.db_url = os.environ.get("HANDWERK_DB_URL", default_db)
        self.storage_dir = Path(
            os.environ.get("HANDWERK_STORAGE_DIR", str(self.data_dir / "files"))
        ).resolve()
        self.token_secret = self._load_secret()
        self.access_token_minutes = int(os.environ.get("HANDWERK_ACCESS_TOKEN_MINUTES", "720"))
        self.max_upload_mb = int(os.environ.get("HANDWERK_MAX_UPLOAD_MB", "25"))
        self.lockout_seconds = int(os.environ.get("HANDWERK_LOCKOUT_SECONDS", "30"))
        self.lockout_after_fails = int(os.environ.get("HANDWERK_LOCKOUT_AFTER_FAILS", "5"))
        self.sync_allow_lww = os.environ.get("HANDWERK_SYNC_ALLOW_LWW", "false").lower() == "true"
        self.admin_email = os.environ.get("HANDWERK_ADMIN_EMAIL", "admin@handwerkeros.local")
        self.admin_password = os.environ.get("HANDWERK_ADMIN_PASSWORD", "")

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _load_secret(self) -> str:
        env = os.environ.get("HANDWERK_TOKEN_SECRET")
        if env:
            return env
        self.ensure_dirs()
        secret_file = self.data_dir / "secret_key"
        if secret_file.exists():
            return secret_file.read_text().strip()
        generated = secrets.token_hex(32)
        secret_file.write_text(generated)
        return generated


settings = Settings()

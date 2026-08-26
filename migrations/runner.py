import importlib
import pkgutil
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at VARCHAR(32) NOT NULL
)
"""


def _version_modules() -> list:
    from migrations.versions import __path__ as package_path

    modules = []
    for module_info in pkgutil.iter_modules(package_path):
        module = importlib.import_module(f"migrations.versions.{module_info.name}")
        modules.append(module)
    modules.sort(key=lambda m: m.VERSION)
    return modules


def run_migrations(engine: Engine) -> list[str]:
    applied_now: list[str] = []
    with engine.begin() as conn:
        conn.execute(text(CREATE_TABLE))
    for module in _version_modules():
        version = getattr(module, "VERSION", None)
        upgrade = getattr(module, "upgrade", None)
        if version is None or upgrade is None:
            continue
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT version FROM schema_migrations WHERE version = :v"),
                {"v": version},
            ).fetchone()
            already_applied = row is not None
        if already_applied:
            continue
        upgrade(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO schema_migrations (version, applied_at) "
                    "VALUES (:v, :at)"
                ),
                {
                    "v": version,
                    "at": datetime.utcnow().replace(microsecond=0).isoformat(),
                },
            )
        applied_now.append(version)
    return applied_now


def main() -> None:
    from sqlalchemy import create_engine

    from app.backend.config import settings

    url = settings.db_url
    target = create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
    )
    applied = run_migrations(target)
    print(f"Datenbank: {url}")
    print(f"Neu angewendet: {applied if applied else 'keine (bereits aktuell)'}")


if __name__ == "__main__":
    main()

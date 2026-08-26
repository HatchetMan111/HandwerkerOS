import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app.backend.api import (
    auth,
    customers,
    defects,
    devices,
    files,
    forms,
    inspections,
    projects,
    sync,
    system,
    users,
)
from app.backend.bootstrap import ensure_bootstrap
from app.backend.config import REPO_ROOT, settings
from app.backend.db import engine
from migrations.runner import run_migrations

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

DIST_DIR = REPO_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_migrations(engine)
    ensure_bootstrap()
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="Lokale, offline-first Handwerker-Dokumentationsplattform",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(system.router)
    for router in (
        auth.router,
        users.router,
        customers.router,
        projects.router,
        devices.router,
        forms.router,
        inspections.router,
        defects.router,
        files.router,
        sync.router,
    ):
        application.include_router(router, prefix="/api")

    _register_spa(application)
    return application


def _register_spa(application: FastAPI) -> None:
    index_file = DIST_DIR / "index.html"

    @application.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request):
        if full_path.startswith("api/") or full_path == "api":
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        if index_file.exists():
            candidate = (DIST_DIR / full_path).resolve()
            try:
                candidate.relative_to(DIST_DIR.resolve())
            except ValueError:
                candidate = None
            if full_path and candidate is not None and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index_file)
        return HTMLResponse(
            "<html><head><title>HandwerkerOS</title></head>"
            "<body style='font-family:sans-serif;max-width:42rem;margin:4rem auto'>"
            "<h1>HandwerkerOS API laeuft.</h1>"
            "<p>Das Frontend ist noch nicht gebaut. Siehe README (Phase: Frontend/PWA).</p>"
            f"<p>Version: {settings.version}</p>"
            "<p><a href='/docs'>API-Doku (OpenAPI)</a></p></body></html>",
            status_code=200,
        )


app = create_app()

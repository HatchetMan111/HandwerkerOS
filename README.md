# HandwerkerOS

Lokale, offline-first Handwerker-Dokumentationsplattform mit PWA-Client und synchronisierter Serverdatenbank.

**Version:** siehe [VERSION](VERSION) · **Status:** Phase 1 (Core) + Sync-Kern implementiert

## Architektur

```
Browser (PWA, IndexedDB, Sync Queue)
        │
        ▼
FastAPI (REST + /api/sync)  ──  SQLite  ──  File Storage
```

- **Backend:** Python / FastAPI / SQLAlchemy 2.x / SQLite (PostgreSQL-fähig vorbereitet)
- **Auth:** lokale Benutzer, Rollen (`admin`, `manager`, `foreman`, `worker`, `viewer`), PBKDF2-Passworthashes, HMAC-Token, Login-Lockout
- **Sync Engine:** UUIDs clientseitig, `operation_id`-Idempotenz (persistiert, überlebt Neustarts), optimistische Versionskonflikte, optionales Last-Write-Wins (`HANDWERK_SYNC_ALLOW_LWW=true`)
- **Audit Log:** append-only; WHO/WHAT/WHEN/BEFORE/AFTER/DEVICE/IP; wird garantiert persistiert (eigene Transaktion nach dem Business-Commit)
- **Formulare:** versioniert (`form_template_id` + `form_version_id`); abgeschlossene Prüfungen referenzieren exakt die Version, mit der sie ausgeführt wurden; Statusworkflow `draft → in_progress → completed → reviewed → archived` mit Bearbeitungssperre
- **Dateien:** MIME-Sniffing (JPEG/PNG/WebP/PDF), Größenlimit, SHA256-Prüfung, Pfad-Traversal-Schutz, lokale Ablage unter `storage/organizations/default/...`

## Quickstart (Entwicklung)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./scripts/dev.sh            # uvicorn auf http://127.0.0.1:8080
```

Beim ersten Start werden Migrationen automatisch angewendet und ein Bootstrap-Admin angelegt.
Zugangsdaten über Umgebungsvariablen steuerbar:

| Variable | Default |
|---|---|
| `HANDWERK_ADMIN_EMAIL` | `admin@handwerkeros.local` |
| `HANDWERK_ADMIN_PASSWORD` | zufällig generiert (steht im Serverlog) |
| `HANDWERK_DATA_DIR` | `./storage/data` |
| `HANDWERK_STORAGE_DIR` | `$HANDWERK_DATA_DIR/files` |
| `HANDWERK_PORT` | `8080` (via systemd-Unit/uvicorn) |
| `HANDWERK_MAX_UPLOAD_MB` | `25` |
| `HANDWERK_SYNC_ALLOW_LWW` | `false` |

## Tests & Lint

```bash
./scripts/test.sh           # ruff + pytest
# oder einzeln:
python3 -m ruff check .
python3 -m pytest
python3 -m bash -n scripts/*.sh   # Shell-Syntax
```

Abgedeckt: Health/Auth/RBAC, Formularversionierung, Statusworkflow, Datei-Upload,
Sync-Idempotenz, Konflikterkennung, LWW, Pull, Audit-Persistenz (RegressionsTest gegen
den „Einträge nach Commit verloren“-Bug), Lockout.

## API (Auszug)

| Endpoint | Zweck |
|---|---|
| `GET /health`, `/ready`, `/version` | Betrieb/Diagnose |
| `POST /api/auth/login`, `GET /api/auth/me` | Authentifizierung |
| `GET/POST/PATCH /api/users` | Benutzerverwaltung (`users.manage`) |
| `GET/POST/PATCH /api/customers`, `/api/projects` | Stammdaten |
| `GET/POST /api/devices`, `/{id}/disable` | Geräteverwaltung |
| `GET/POST /api/forms/templates[...]` | Form Builder + versionierte Schemata |
| `GET/POST/PATCH /api/inspections`, `/{id}/complete`, `/{id}/transition` | Prüfungen |
| `GET/POST/PATCH /api/defects` | Mängel |
| `POST/GET /api/files` | Fotos/Dokumente (Multipart, SHA256) |
| `POST /api/sync`, `GET /api/sync/changes` | Offline-Sync (Push/Pull) |

Interaktive Doku: `http://localhost:8080/docs`

## Sync-Protokoll (v1)

Jede Operation enthält `operation_id` (Client-UUID), `entity`, `entity_id`, `operation`,
`payload`, `base_version`, `client_updated_at`. Der Server antwortet pro Operation:

```json
{"status": "applied", "server_version": 2}
{"status": "duplicate"}
{"status": "applied", "replayed": true}
{"status": "conflict", "conflict": {"server_state": {...}, "server_version": 3}}
{"status": "rejected", "error": "base_version_required"}
```

Idempotenz ist datenbankseitig: `operation_id` ist Primärschlüssel der
`sync_operations`-Tabelle; Replays liefern das ursprüngliche Ergebnis ohne erneute Anwendung.

## Installation (Proxmox LXC)

Geplant als Community-Scripts-Einzeiler (Phase „Proxmox“):

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerOS/main/install/handwerkeros.sh)"
```

Bereits vorhanden: [`systemd/handwerkeros.service`](systemd/handwerkeros.service)
(`Restart=always`, `After=network-online.target`, ReadWritePaths auf Storage).

## Update / Deinstallation (geplant)

- **Update:** Backup → `git pull` bzw. Release-Tarball → `python -m migrations.runner` → Service-Restart → `/health`
- **Deinstallation:** `systemctl stop handwerkeros && systemctl disable handwerkeros`, danach Container löschen; Daten liegen vollständig unter `storage/`

## Roadmap

Siehe Plan: Frontend/PWA (React+TS+Vite, IndexedDB, Service Worker) → Berichte (PDF) →
Backup/Restore inkl. Restore-Test → Proxmox-Installer → Qualitätstests.

## Lizenz

noch nicht festgelegt (Vorschlag: MIT)

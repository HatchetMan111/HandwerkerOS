# HandwerkerOS

Lokale, offline-first Handwerker-Dokumentationsplattform mit PWA-Client und synchronisierter Serverdatenbank.

**Version:** siehe [VERSION](VERSION) · **Status:** Core + Web-UI + Zeit/Material + Offline-Sync (inkl. Fotos) + Berichte

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
| `HANDWERK_ADMIN_EMAIL` | `admin` (Benutzername oder E-Mail als Login) |
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

## Zeit & Material + Offline (Phase 5/8, v0.4)

**Offline-faehig:** Stundenzettel und Materialverbrauch funktionieren **ohne Empfang**
(IndexedDB-Sync-Queue, Service Worker App-Shell). Badge zeigt offene Aenderungen,
automatischer Upload bei Netzrueckkehr - idempotent ueber operation_id.

| Feature | Wo |
|---|---|
| Stundenzettel (Wochenansicht, Abgeben/Freigabe) | Tab *Zeit* |
| Materialverbrauch aus Katalog oder Freitext | Tab *Material* |
| Einsatzplanung pro Woche | Mehr -> Einsatzplanung |
| Rechnung = Zeit x Satz + Material (Vorschau, Drucken/PDF) | Mehr -> Rechnungen |
| Gewaehrleistungs-Fotos je Baustelle | Mehr -> Gewaehrleistung |
| Formular-Vorausfuellung fuer Checklisten | Formular-Builder -> Feld -> Vorausfuellung |

Freigegebene Zeiten sind rechnungssicher gesperrt; Freigabe nur mit
`reports.create` (Betriebsleiter/Bauleiter/Admin).

## Web-UI / PWA

Das Frontend (React + TypeScript + Vite) liegt fertig gebaut unter `frontend/dist/` im Repo
und wird vom Backend automatisch ausgeliefert – kein Node.js im LXC nötig.

Funktionen: Login mit Benutzername oder E-Mail + Rollen, Dashboard mit Schnellerfassung, Kunden & Projekte,
Formularvorlagen inkl. Versionsanlage, Prüfungsdetails mit dynamischem Formular-Renderer
(alle Feldtypen inkl. Unterschriften-Pad und Foto-/Datei-Upload je Feld), Mängelerfassung
mit Status, Abschluss-Workflow, Offline-Badge, Toasts.

Entwicklung:

```bash
cd frontend && npm install   # oder pnpm install
npm run dev                  # http://localhost:5173 mit Proxy auf :8080
npm run build                # produziert frontend/dist/
npm run typecheck
```

Nach Code-Änderungen: `npm run build` committen (dist liegt im Repo), damit der
LXC-Installer sie ohne Build-Schritt verteilen kann.

## Installation (Proxmox LXC)

Einzeiler auf dem Proxmox-Host (als root):

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerOS/main/install/handwerkeros.sh)"
```

Das Script: prüft Root/Proxmox, wählt automatisch eine freie CT-ID, erstellt einen
**unprivilegierten Debian-12-LXC** (`onboot=1`, Startwerte: 2 vCPU / 2 GB RAM / 8 GB Disk),
installiert die App im Container, richtet systemd ein und verifiziert Service + Health-Check.
Am Ende erscheint die fertige URL `http://<CT-IP>:8080` samt Admin-Zugangsdaten.

**Idempotent:** erneutes Ausführen erkennt die bestehende HandwerkerOS-CT und führt ein
Update durch (Code-Pull, pip-Install, Service-Restart, Health-Check). Vorhandene Daten
bleiben unberührt.

Parameter per Umgebungsvariable:

```bash
CTID=150 STORAGE=local BRIDGE=vmbr0 CORES=2 RAM=2048 DISK=16 \
  bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/HandwerkerOS/main/install/handwerkeros.sh)"
```

| Variable | Default | Bedeutung |
|---|---|---|
| `CTID` | automatisch (freie ID) | Container-ID; bei existierender CT → Update-Modus |
| `STORAGE` | `local` | Proxmox-Storage für rootfs + Template |
| `BRIDGE` | `vmbr0` | Netzwerk-Bridge |
| `CORES`/`RAM`/`DISK` | `2`/`2048`/`8` | Ressourcen |
| `SWAP` | `512` | Swap in MB |

**Debugging:** Bei Fehlern gibt das Script Exit-Code, Befehl, CT-Journal-Auszug und
Logdatei aus (`/tmp/handwerkeros-install-*.log`). Debug-Lauf:
`bash -x <(wget -qLO - <url>)`.

**Deinstallation:** `pct stop <CTID> && pct destroy <CTID>` – alle Daten liegen
ausschließlich im Container unter `/opt/handwerkeros/storage`.

## Update / Deinstallation (geplant)

- **Update:** Backup → `git pull` bzw. Release-Tarball → `python -m migrations.runner` → Service-Restart → `/health`
- **Deinstallation:** `systemctl stop handwerkeros && systemctl disable handwerkeros`, danach Container löschen; Daten liegen vollständig unter `storage/`

## Roadmap

Siehe Plan: Frontend/PWA (React+TS+Vite, IndexedDB, Service Worker) → Berichte (PDF) →
Backup/Restore inkl. Restore-Test → Proxmox-Installer → Qualitätstests.

## Lizenz

noch nicht festgelegt (Vorschlag: MIT)

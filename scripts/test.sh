#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== ruff =="
python3 -m ruff check .

echo "== pytest =="
python3 -m pytest

echo "Alle Checks erfolgreich."

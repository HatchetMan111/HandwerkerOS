#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d frontend ]; then
    echo "frontend/ fehlt."
    exit 1
fi

cd frontend
if [ ! -d node_modules ]; then
    npm install
fi
npm run build
echo "Frontend gebaut: frontend/dist/"

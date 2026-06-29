#!/usr/bin/env bash
# setup_venv.sh — Run once to create project-local virtual environment
# Usage: bash setup_venv.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
echo "Creating .venv in $SCRIPT_DIR ..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt
echo ""
echo "✓ venv ready"
echo "  Activate : source .venv/bin/activate"
echo "  Run      : python3 run.py"
echo "  Backend  : uvicorn backend.main:app --reload --port 8002"
echo "  Frontend : cd frontend && npm run dev"
echo "  Tests    : cd tests && python3 -m pytest -v"

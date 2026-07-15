#!/usr/bin/env bash
# setup_venv.sh — Run once to create project-local virtual environment
# Requires Python 3.11+ (CI pins 3.11 for SHAP/LightGBM C-extension stability;
# 3.12 and 3.13 also work locally). Install via pyenv (see README.md).
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Python version check ──────────────────────────────────────────────────────
if command -v python3.13 &>/dev/null; then
  PYTHON=python3.13
  echo "Using $($PYTHON --version)"
elif command -v python3.11 &>/dev/null; then
  PYTHON=python3.11
  echo "Using $($PYTHON --version)"
else
  echo "python3.11 not found — falling back to python3."
  echo "   Python 3.11+ required — see README.md."
  PYTHON=python3
fi

echo "Creating .venv in $SCRIPT_DIR ..."
$PYTHON -m venv .venv
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt
echo ""
echo "✓ venv ready  ($($PYTHON --version))"
echo "  Activate : source .venv/bin/activate"
echo "  Backend  : uvicorn backend.main:app --reload --port 8002"
echo "  Frontend : cd frontend && npm run dev"
echo "  Tests    : python3 -m pytest tests/ -v"

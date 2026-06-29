set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"
echo " Creating .venv in $SCRIPT_DIR"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt
echo ""
echo " venv setup complete. To activate the virtual environment, run:"
#!/usr/bin/env bash
# Live E2E smoke test — hits the REAL running API (not mocks) for a quick
# end-to-end sanity check of the Daily and Hourly pipelines.
#
# This is intentionally NOT part of `pytest tests/` (which stays fast,
# deterministic, and offline-safe). Run this manually against a live
# `uvicorn backend.main:app --port 8002` instance when you want to confirm
# the whole stack (DB + data feed + pipeline + API) works with real data.
#
# Usage:
#   ./scripts/smoke_test.sh                 # full default 50-ticker universe
#   ./scripts/smoke_test.sh AAPL MSFT NVDA  # custom ticker subset (faster)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8002}"
TICKERS="${*:-}"

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; exit 1; }

echo "== 1. Health check =="
HEALTH=$(curl -sf "$BASE_URL/health") || fail "backend not reachable at $BASE_URL"
echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['status']=='ok'" \
  && pass "status=ok" || fail "health status != ok"
echo "$HEALTH"

echo ""
echo "== 2. Ticker universe =="
TICKERS_JSON=$(curl -sf "$BASE_URL/api/tickers")
COUNT=$(echo "$TICKERS_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
pass "GET /api/tickers -> $COUNT tickers"

echo ""
echo "== 3. Daily pipeline (POST /api/run) =="
START=$(date +%s)
if [ -n "$TICKERS" ]; then
  BODY=$(python3 -c "import json,sys; print(json.dumps({'tickers': sys.argv[1:]}))" $TICKERS)
  DAILY=$(curl -sf -X POST "$BASE_URL/api/run" -H 'Content-Type: application/json' -d "$BODY")
else
  DAILY=$(curl -sf -X POST "$BASE_URL/api/run")
fi
END=$(date +%s)
echo "$DAILY" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'run_id' in d or d.get('status')" \
  && pass "Daily run completed in $((END-START))s" || fail "Daily run response malformed"
echo "$DAILY" | head -c 300; echo ""

echo ""
echo "== 4. Hourly pipeline (POST /api/intraday/run) =="
START=$(date +%s)
if [ -n "$TICKERS" ]; then
  HOURLY=$(curl -sf -X POST "$BASE_URL/api/intraday/run" -H 'Content-Type: application/json' -d "$BODY")
else
  HOURLY=$(curl -sf -X POST "$BASE_URL/api/intraday/run")
fi
END=$(date +%s)
echo "$HOURLY" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'ic_summary' in d or d.get('status')" \
  && pass "Hourly run completed in $((END-START))s" || fail "Hourly run response malformed"
echo "$HOURLY" | head -c 300; echo ""

echo ""
echo "== 5. Signals retrieval =="
curl -sf "$BASE_URL/api/signals" >/dev/null && pass "GET /api/signals reachable"
curl -sf "$BASE_URL/api/intraday/signals" >/dev/null && pass "GET /api/intraday/signals reachable"

echo ""
echo "All smoke checks passed."

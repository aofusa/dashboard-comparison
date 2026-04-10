#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BASE_URL:=http://127.0.0.1:3000}"
export BENCH_IMPL="lean-next-hono"
export BASE_URL
export BENCH_API_FLAVOR="lean-rest"
echo "[lean-next-hono] BENCH_API_FLAVOR=${BENCH_API_FLAVOR} BASE_URL=${BASE_URL}（REST login/items + /api/version。最小計測は BENCH_API_FLAVOR=lean-public）"
exec bash "${DIR}/run-scenarios.sh"

#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BASE_URL:=http://127.0.0.1:3000}"
export BENCH_IMPL="lean-next-hono"
export BASE_URL
export BENCH_API_FLAVOR="lean-public"
echo "[lean-next-hono] BASE_URL=${BASE_URL}（/api/health・/api/version）"
exec bash "${DIR}/run-scenarios.sh"

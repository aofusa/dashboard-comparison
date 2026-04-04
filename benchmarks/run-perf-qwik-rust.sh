#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BASE_URL:=http://127.0.0.1:8080}"
export BENCH_IMPL="perf-qwik-rust"
export BASE_URL
export BENCH_API_FLAVOR="rust"
echo "[perf-qwik-rust] BASE_URL=${BASE_URL} (Axum /api 直下)"
exec bash "${DIR}/run-scenarios.sh"

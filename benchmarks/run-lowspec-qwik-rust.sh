#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BASE_URL:=http://127.0.0.1:8080}"
export BENCH_IMPL="lowspec-qwik-rust"
export BASE_URL
export BENCH_API_FLAVOR="rust"
echo "[lowspec-qwik-rust] BASE_URL=${BASE_URL}（perf と同時起動時は別ポート推奨）"
exec bash "${DIR}/run-scenarios.sh"

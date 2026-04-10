#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bench-env.sh
source "${DIR}/lib/bench-env.sh"
bench_bootstrap_base_url "${DIR}" "apps/lowspec-qwik-rust/backend/.env" "lowspec-qwik-rust"
export BENCH_IMPL="lowspec-qwik-rust"
export BENCH_API_FLAVOR="graphql-only"
echo "[lowspec-qwik-rust] BENCH_API_FLAVOR=${BENCH_API_FLAVOR} BASE_URL=${BASE_URL}（perf と同時起動時は別ポート推奨）"
exec bash "${DIR}/run-scenarios.sh"

#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bench-env.sh
source "${DIR}/lib/bench-env.sh"
bench_bootstrap_base_url "${DIR}" "apps/perf-qwik-rust/backend/.env" "perf-qwik-rust"
export BASE_URL="http://127.0.0.1:9080"
export BENCH_IMPL="perf-qwik-rust"
export BENCH_API_FLAVOR="graphql-only"
echo "[perf-qwik-rust] BENCH_API_FLAVOR=${BENCH_API_FLAVOR} BASE_URL=${BASE_URL}（GraphQL ベンチ・rust は後方互換エイリアス）"
exec bash "${DIR}/run-scenarios.sh"

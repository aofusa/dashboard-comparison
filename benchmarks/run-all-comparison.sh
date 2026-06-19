#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 第 1 引数: 各 run-scenarios に渡す BENCH_ROUNDS（既定 1）。例: ./run-all-comparison.sh 3
if [[ "${1:-}" != "" ]]; then
  if ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
    echo "[run-all-comparison] 第 1 引数は正の整数（BENCH_ROUNDS）のみ: got $1" >&2
    exit 1
  fi
  export BENCH_ROUNDS="$1"
fi
echo "=== BENCH_ROUNDS=${BENCH_ROUNDS:-1} ==="
echo "=== perf-qwik-rust ==="
bash "${DIR}/run-perf-qwik-rust.sh" || true
echo "=== lowspec-qwik-rust（別ポートなら BASE_URL=... を指定）==="
bash "${DIR}/run-lowspec-qwik-rust.sh" || true
echo "=== lean-next-hono（例: BASE_URL=http://localhost:3000・db:seed 済み・lean-rest）==="
bash "${DIR}/run-lean-next-hono.sh" || true
echo "=== 表生成: python3 tools/generate-comparison-table.py（stdout）==="

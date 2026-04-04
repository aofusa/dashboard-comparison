#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== perf-qwik-rust（Axum :8080 想定）==="
bash "${DIR}/run-perf-qwik-rust.sh" || true
echo "=== lowspec-qwik-rust（別ポートなら BASE_URL=... を指定）==="
bash "${DIR}/run-lowspec-qwik-rust.sh" || true
echo "=== lean-next-hono（Next :3000 想定）==="
bash "${DIR}/run-lean-next-hono.sh" || true
echo "=== 表生成: python3 tools/generate-comparison-table.py ==="

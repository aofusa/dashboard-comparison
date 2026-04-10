#!/usr/bin/env bash
# shellcheck shell=bash
# ベンチ用: backend/.env の BIND_ADDR から BASE_URL を合成（run-* ラッパーから source）

# 1 行目の BIND_ADDR=host:port を読む（export 可、\r 除去）
bench_read_bind_addr() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  local line v
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?BIND_ADDR=' "$f" 2>/dev/null | tail -1 | tr -d '\r')" || return 1
  [[ -n "$line" ]] || return 1
  v="${line#*=}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%%[[:space:]]*}"
  v="${v#\"}"
  v="${v%\"}"
  v="${v#\'}"
  v="${v%\'}"
  [[ -n "$v" ]] || return 1
  printf '%s' "$v"
}

# BENCH_USE_TLS=1 なら https://（将来の TLS 直叩き用）
bench_bind_to_base_url() {
  local bind="$1"
  local scheme=http
  [[ "${BENCH_USE_TLS:-}" == "1" ]] && scheme=https
  printf '%s://%s' "$scheme" "$bind"
}

# bench_dir: benchmarks/ の絶対パス
# default_backend_env: リポジトリルートからの相対（例 apps/lowspec-qwik-rust/backend/.env）
# impl_name: ログ用
bench_bootstrap_base_url() {
  local bench_dir="$1"
  local default_backend_env="$2"
  local impl_name="${3:-app}"

  local root env_file
  root="$(cd "${bench_dir}/.." && pwd)"

  if [[ -n "${BENCH_ENV_FILE:-}" ]]; then
    env_file="${BENCH_ENV_FILE}"
    [[ "${env_file}" != /* ]] && env_file="${bench_dir}/${env_file}"
    if [[ -f "${env_file}" ]]; then
      # shellcheck source=/dev/null
      set -a && source "${env_file}" && set +a
      echo "[bench-env] ${impl_name}: sourced BENCH_ENV_FILE=${env_file}"
    else
      echo "[bench-env] warning: BENCH_ENV_FILE not found: ${env_file}" >&2
    fi
  fi

  if [[ -n "${BASE_URL:-}" ]]; then
    echo "[bench-env] ${impl_name}: BASE_URL 既設定のため BIND_ADDR からは合成しません (${BASE_URL})"
    export BASE_URL
    return 0
  fi

  if [[ -n "${BENCH_ENV_FILE:-}" ]]; then
    env_file="${BENCH_ENV_FILE}"
    [[ "${env_file}" != /* ]] && env_file="${bench_dir}/${env_file}"
  else
    env_file="${root}/${default_backend_env}"
  fi

  local bind
  if bind="$(bench_read_bind_addr "${env_file}")"; then
    BASE_URL="$(bench_bind_to_base_url "${bind}")"
    export BASE_URL
    echo "[bench-env] ${impl_name}: BIND_ADDR from ${env_file} -> BASE_URL=${BASE_URL}"
  else
    BASE_URL="http://127.0.0.1:8080"
    export BASE_URL
    echo "[bench-env] ${impl_name}: BIND_ADDR なしまたは ${env_file} 不在のためフォールバック BASE_URL=${BASE_URL}"
  fi
}

#!/usr/bin/env bash
# shellcheck source=lib/bench-lib.sh
set -euo pipefail

# 1 回の総時間（秒）。HTTP は 2xx のみ採用。
bench_curl_time() {
  local raw ec time code
  raw="$(curl -s -o /dev/null -w '%{time_total}\n%{http_code}' --connect-timeout 2 --max-time 60 "$@" 2>/dev/null)"
  ec=$?
  [[ "${ec}" -ne 0 ]] && return 0
  time="$(echo "${raw}" | sed -n '1p')"
  code="$(echo "${raw}" | sed -n '2p')"
  [[ "${code}" =~ ^2[0-9][0-9]$ ]] && echo "${time}"
  return 0
}

bench_stats_ms() {
  sort -n | awk '
    { a[++n] = $1 }
    END {
      if (n == 0) { print "null null"; exit 0 }
      mid = int((n + 1) / 2)
      med = (n % 2 == 1) ? a[mid] : (a[mid] + a[mid + 1]) / 2
      p95i = int(n * 0.95)
      if (p95i < 1) p95i = 1
      if (p95i > n) p95i = n
      printf "%.3f %.3f\n", med * 1000, a[p95i] * 1000
    }'
}

bench_repeat() {
  local n="$1"
  shift
  local out i
  out="$(mktemp)"
  for ((i = 0; i < n; i++)); do
    local t
    t="$(bench_curl_time "$@")"
    [[ -n "${t}" ]] && echo "${t}" >>"${out}"
  done
  cat "${out}"
  rm -f "${out}"
}

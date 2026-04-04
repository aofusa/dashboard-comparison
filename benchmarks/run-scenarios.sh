#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bench-lib.sh
source "${DIR}/lib/bench-lib.sh"

: "${BENCH_IMPL:=unknown}"
: "${BASE_URL:=http://127.0.0.1:8080}"
: "${BENCH_API_FLAVOR:=rust}"
: "${BENCH_EMAIL:=dev@example.com}"
: "${BENCH_PASSWORD:=devpass}"
: "${BENCH_SAMPLES_HEALTH:=20}"
: "${BENCH_SAMPLES_AUTH:=12}"

RESULTS_DIR="${DIR}/results"
mkdir -p "${RESULTS_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_JSON="${RESULTS_DIR}/${BENCH_IMPL}_${STAMP}.json"

health_url="${BASE_URL}/api/health"
version_url="${BASE_URL}/api/version"

read -r health_median health_p95 < <(bench_repeat "${BENCH_SAMPLES_HEALTH}" -X GET "${health_url}" | bench_stats_ms) || true

login_ms="null"
items_ms_median="null"
items_ms_p95="null"
graphql_health_ms_median="null"
graphql_health_ms_p95="null"
graphql_nested_ms_median="null"
graphql_nested_ms_p95="null"
version_ms_median="null"
version_ms_p95="null"
seq_throughput=""
notes_json="[]"

notes=()
if [[ "${BENCH_API_FLAVOR}" == "rust" ]]; then
  login_body="$(printf '%s' "{\"email\":\"${BENCH_EMAIL}\",\"password\":\"${BENCH_PASSWORD}\"}")"
  t0="$(bench_curl_time -X POST "${BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "${login_body}")"
  if [[ -n "${t0}" ]]; then
    login_ms="$(awk -v s="${t0}" 'BEGIN{printf "%.3f", s * 1000}')"
  fi

  login_raw="$(curl -s --connect-timeout 2 --max-time 30 -w '\n%{http_code}' -X POST "${BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "${login_body}" 2>/dev/null || true)"
  login_code="$(echo "${login_raw}" | tail -n1)"
  login_resp="$(echo "${login_raw}" | sed '$d')"
  token=""
  if [[ "${login_code}" =~ ^2[0-9][0-9]$ ]]; then
    if command -v jq >/dev/null 2>&1; then
      token="$(echo "${login_resp}" | jq -r '.token // empty' 2>/dev/null || true)"
    else
      token="$(echo "${login_resp}" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    fi
  fi

  if [[ -n "${token}" ]]; then
    read -r items_ms_median items_ms_p95 < <(bench_repeat "${BENCH_SAMPLES_AUTH}" -X GET "${BASE_URL}/api/items?page=1&pageSize=10" \
      -H "Authorization: Bearer ${token}" | bench_stats_ms) || true

    gql='{"query":"query { health }"}'
    read -r graphql_health_ms_median graphql_health_ms_p95 < <(bench_repeat 10 -X POST "${BASE_URL}/api/graphql" \
      -H 'Content-Type: application/json' \
      -d "${gql}" | bench_stats_ms) || true

    gql2='{"query":"query { items(page: 1, pageSize: 5) { total items { id title user { email } } } }"}'
    read -r graphql_nested_ms_median graphql_nested_ms_p95 < <(bench_repeat 8 -X POST "${BASE_URL}/api/graphql" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${token}" \
      -d "${gql2}" | bench_stats_ms) || true
  else
    if [[ -n "${login_code}" ]] && [[ ! "${login_code}" =~ ^2[0-9][0-9]$ ]]; then
      notes+=("login failed: HTTP ${login_code} (items/graphql skipped)")
    else
      notes+=("login failed: no token in JSON (items/graphql skipped)")
    fi
  fi
elif [[ "${BENCH_API_FLAVOR}" == "lean-public" ]]; then
  read -r version_ms_median version_ms_p95 < <(bench_repeat 10 -X GET "${version_url}" | bench_stats_ms) || true
  notes+=("items/graphql は NextAuth 必須のため未計測")
else
  notes+=("unknown BENCH_API_FLAVOR=${BENCH_API_FLAVOR}")
fi

seq_throughput="$(bench_repeat 80 -X GET "${health_url}" | awk '{s+=1;t+=$1} END{if(t>0)printf "%.2f",s/t; else print ""}')"

if ((${#notes[@]})); then
  notes_json="$(printf '%s\n' "${notes[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
fi

export STAMP BENCH_IMPL BASE_URL BENCH_API_FLAVOR
export BENCH_OUT_JSON="${OUT_JSON}"
export BENCH_NOTES_JSON="${notes_json}"
export E_HEALTH_MED="${health_median}" E_HEALTH_P95="${health_p95}"
export E_LOGIN="${login_ms}"
export E_ITEMS_MED="${items_ms_median}" E_ITEMS_P95="${items_ms_p95}"
export E_GH_MED="${graphql_health_ms_median}" E_GH_P95="${graphql_health_ms_p95}"
export E_GN_MED="${graphql_nested_ms_median}" E_GN_P95="${graphql_nested_ms_p95}"
export E_VER_MED="${version_ms_median}" E_VER_P95="${version_ms_p95}"
export E_SEQ="${seq_throughput}"

python3 <<'PY'
import json, os

def num_or_none(x):
    if x is None or x == "" or x == "null":
        return None
    try:
        return float(x)
    except ValueError:
        return None

out = os.environ["BENCH_OUT_JSON"]
data = {
    "implementation": os.environ.get("BENCH_IMPL", ""),
    "base_url": os.environ.get("BASE_URL", ""),
    "api_flavor": os.environ.get("BENCH_API_FLAVOR", ""),
    "utc_stamp": os.environ.get("STAMP", ""),
    "scenarios": {
        "health_get_ms_median": num_or_none(os.environ.get("E_HEALTH_MED")),
        "health_get_ms_p95": num_or_none(os.environ.get("E_HEALTH_P95")),
        "login_post_ms": num_or_none(os.environ.get("E_LOGIN")),
        "items_get_ms_median": num_or_none(os.environ.get("E_ITEMS_MED")),
        "items_get_ms_p95": num_or_none(os.environ.get("E_ITEMS_P95")),
        "graphql_health_ms_median": num_or_none(os.environ.get("E_GH_MED")),
        "graphql_health_ms_p95": num_or_none(os.environ.get("E_GH_P95")),
        "graphql_nested_ms_median": num_or_none(os.environ.get("E_GN_MED")),
        "graphql_nested_ms_p95": num_or_none(os.environ.get("E_GN_P95")),
        "version_get_ms_median": num_or_none(os.environ.get("E_VER_MED")),
        "version_get_ms_p95": num_or_none(os.environ.get("E_VER_P95")),
        "health_seq_80_approx_req_per_s": num_or_none(os.environ.get("E_SEQ")),
    },
    "notes": json.loads(os.environ.get("BENCH_NOTES_JSON", "[]")),
}
with open(out, "w") as f:
    json.dump(data, f, indent=2)
PY

echo "[bench] wrote ${OUT_JSON}"
cat "${OUT_JSON}"

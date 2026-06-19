#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bench-lib.sh
source "${DIR}/lib/bench-lib.sh"

: "${BENCH_IMPL:=unknown}"
: "${BASE_URL:=http://127.0.0.1:8080}"
: "${BENCH_API_FLAVOR:=graphql-only}"
: "${BENCH_EMAIL:=dev@example.com}"
: "${BENCH_PASSWORD:=devpass}"
: "${BENCH_SAMPLES_HEALTH:=20}"
: "${BENCH_SAMPLES_AUTH:=12}"
: "${BENCH_ROUNDS:=1}"
: "${BENCH_ROUND_SLEEP_SEC:=0}"

RESULTS_DIR="${DIR}/results"
mkdir -p "${RESULTS_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if ! [[ "${BENCH_ROUNDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "[bench] BENCH_ROUNDS must be a positive integer, got: ${BENCH_ROUNDS}" >&2
  exit 1
fi

health_url="${BASE_URL}/api/health"
version_url="${BASE_URL}/api/version"
graphql_url="${BASE_URL}/api/graphql"

# BENCH_API_FLAVOR の真実源は benchmarks/scenarios/API_MATRIX.md および benchmarks/scenarios/README.md を参照。

gql_auth_mutation_body() {
  # GraphQL 変数で認証情報を渡し、シェル printf の \" 解釈で JSON が壊れる問題を避ける（指示書 20260410）
  BENCH_EMAIL="${BENCH_EMAIL}" BENCH_PASSWORD="${BENCH_PASSWORD}" python3 <<'PY'
import json, os

q = (
    "mutation ($email: String!, $password: String!) "
    "{ authLogin(email: $email, password: $password) { token refreshToken expiresIn } }"
)
print(
    json.dumps(
        {
            "query": q,
            "variables": {
                "email": os.environ["BENCH_EMAIL"],
                "password": os.environ["BENCH_PASSWORD"],
            },
        },
        separators=(",", ":"),
    )
)
PY
}

# authLogin 応答ボディを python3 で解析（jq 非依存）。stdout: 1 行目 token、2 行目 errors 要約（最大 220 文字）
gql_auth_parse_body() {
  local bodyf="$1"
  python3 - "$bodyf" <<'PY'
import json, sys
path = sys.argv[1]
try:
    text = open(path, "r", encoding="utf-8", errors="replace").read()
except OSError as e:
    print("")
    print(f"read error: {e}"[:220])
    raise SystemExit(0)
try:
    j = json.loads(text)
except Exception as e:
    print("")
    print(f"JSON parse: {e!s}"[:220])
    raise SystemExit(0)
errs = j.get("errors") or []
data = j.get("data")
tok = ""
if isinstance(data, dict):
    al = data.get("authLogin")
    if isinstance(al, dict):
        t = al.get("token")
        if t:
            tok = str(t)
msgs = []
for e in errs[:5]:
    if isinstance(e, dict) and e.get("message"):
        msgs.append(str(e["message"]))
    elif isinstance(e, str):
        msgs.append(e)
err_summary = "; ".join(msgs)[:220]
print(tok)
print(err_summary)
PY
}

gql_auth_dump_body_masked() {
  local bodyf="$1"
  python3 - "$bodyf" <<'PY'
import json, sys
p = sys.argv[1]
try:
    raw = open(p, "r", encoding="utf-8", errors="replace").read()
except OSError as e:
    print(f"(read error: {e})", file=sys.stderr)
    raise SystemExit(0)
try:
    j = json.loads(raw)

    def redact(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                lk = str(k).lower()
                if lk in ("token", "refreshtoken", "password", "authorization"):
                    o[k] = "***" if v else v
                else:
                    redact(v)
        elif isinstance(o, list):
            for x in o:
                redact(x)

    redact(j)
    s = json.dumps(j, ensure_ascii=False)
except Exception:
    s = raw
print(s[:900], file=sys.stderr)
PY
}

run_one_benchmark_round() {
  local round_idx="$1"
  if [[ "${BENCH_ROUNDS}" -eq 1 ]]; then
    OUT_JSON="${RESULTS_DIR}/${BENCH_IMPL}_${STAMP}.json"
  else
    OUT_JSON="${RESULTS_DIR}/${BENCH_IMPL}_${STAMP}_r$(printf '%02d' "${round_idx}").json"
  fi

  # ラウンド間でシェル変数が漏れないよう GraphQL / REST 共通の作業変数は local
  local token=""
  local gql_err_sum=""

  local EFFECTIVE_FLAVOR="${BENCH_API_FLAVOR}"
  local notes=()
  if [[ "${BENCH_API_FLAVOR}" == "rust" ]]; then
    EFFECTIVE_FLAVOR="graphql-only"
    notes+=("BENCH_API_FLAVOR=rust は graphql-only と同一（後方互換）。新規は graphql-only 推奨")
  fi

  local login_ms="null"
  local items_ms_median="null"
  local items_ms_p95="null"
  local graphql_health_ms_median="null"
  local graphql_health_ms_p95="null"
  local graphql_nested_ms_median="null"
  local graphql_nested_ms_p95="null"
  local version_ms_median="null"
  local version_ms_p95="null"
  local seq_throughput=""
  local notes_json="[]"

  read -r health_median health_p95 < <(bench_repeat "${BENCH_SAMPLES_HEALTH}" -X GET "${health_url}" | bench_stats_ms) || true

  if [[ "${EFFECTIVE_FLAVOR}" == "graphql-only" ]]; then
    notes+=("graphql-only: GET /api/health は実装により null になり得る。認証は GraphQL authLogin。REST login/items は未計測")

    local gql='{"query":"query { health }"}'
    read -r graphql_health_ms_median graphql_health_ms_p95 < <(bench_repeat 10 -X POST "${graphql_url}" \
      -H 'Content-Type: application/json' \
      -d "${gql}" | bench_stats_ms) || true

    local bodyf
    bodyf="$(mktemp)"
    local curl_out
    curl_out="$(curl -sS --connect-timeout 2 --max-time 60 \
      -o "${bodyf}" -w "%{time_total}\n%{http_code}" \
      -X POST "${graphql_url}" \
      -H 'Content-Type: application/json' \
      -d "$(gql_auth_mutation_body)" 2>/dev/null || printf '0\n000')"
    local _curl_meta time_s code
    mapfile -t _curl_meta <<< "${curl_out}"
    time_s="${_curl_meta[0]:-0}"
    time_s="${time_s//$'\r'/}"
    if ((${#_curl_meta[@]} >= 2)); then
      code="${_curl_meta[1]}"
    else
      code="000"
    fi
    code="${code//$'\r'/}"
    if [[ "${BENCH_DUMP_AUTH_LOGIN:-}" == "1" ]]; then
      echo "[bench] BENCH_DUMP_AUTH_LOGIN authLogin HTTP=${code} body (masked, prefix):" >&2
      gql_auth_dump_body_masked "${bodyf}"
    fi
    local token gql_err_sum
    mapfile -t _gql_auth_lines < <(gql_auth_parse_body "${bodyf}")
    rm -f "${bodyf}"
    token="${_gql_auth_lines[0]:-}"
    gql_err_sum="${_gql_auth_lines[1]:-}"

    if [[ "${code}" =~ ^2[0-9][0-9]$ ]]; then
      login_ms="$(awk -v s="${time_s}" 'BEGIN{printf "%.3f", s * 1000}')"
      if [[ -n "${gql_err_sum}" ]]; then
        notes+=("GraphQL errors (authLogin): ${gql_err_sum}")
      fi
    else
      notes+=("authLogin HTTP ${code}（非2xx・login_post_ms 未計測）")
      if [[ -n "${gql_err_sum}" ]]; then
        notes+=("応答ボディ errors 要約: ${gql_err_sum}")
      fi
    fi
    notes+=("login_post_ms は GraphQL authLogin（1 回・片道 ms; HTTP 2xx 時は GraphQL errors があっても計測）")

    if [[ -n "${token}" ]]; then
      local gql2='{"query":"query { items(page: 1, pageSize: 5) { total items { id title user { email } } } }"}'
      read -r graphql_nested_ms_median graphql_nested_ms_p95 < <(bench_repeat 8 -X POST "${graphql_url}" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${token}" \
        -d "${gql2}" | bench_stats_ms) || true
    else
      if [[ "${code}" =~ ^2[0-9][0-9]$ ]]; then
        if [[ -z "${gql_err_sum}" ]]; then
          notes+=("authLogin は 2xx だが token 抽出不可（nested GraphQL スキップ）")
        else
          notes+=("nested GraphQL スキップ（token なし）")
        fi
      else
        notes+=("nested GraphQL スキップ（authLogin が非2xx または接続失敗）")
      fi
    fi

  elif [[ "${EFFECTIVE_FLAVOR}" == "lean-rest" ]]; then
    notes+=("lean-rest: REST login/items + GET /api/version。GraphQL は未実装のため graphql_* は null")

    local login_body
    login_body="$(printf '%s' "{\"email\":\"${BENCH_EMAIL}\",\"password\":\"${BENCH_PASSWORD}\"}")"
    local t0
    t0="$(bench_curl_time -X POST "${BASE_URL}/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "${login_body}")"
    if [[ -n "${t0}" ]]; then
      login_ms="$(awk -v s="${t0}" 'BEGIN{printf "%.3f", s * 1000}')"
    fi

    local login_raw login_code login_resp
    login_raw="$(curl -s --connect-timeout 2 --max-time 30 -w '\n%{http_code}' -X POST "${BASE_URL}/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "${login_body}" 2>/dev/null || true)"
    login_code="$(echo "${login_raw}" | tail -n1)"
    login_resp="$(echo "${login_raw}" | sed '$d')"
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
    else
      if [[ -n "${login_code}" ]] && [[ ! "${login_code}" =~ ^2[0-9][0-9]$ ]]; then
        notes+=("REST login failed: HTTP ${login_code}（items スキップ）")
      else
        notes+=("REST login: token なし（items スキップ）。db:seed と AUTH_URL/localhost 整合を確認")
      fi
    fi

    read -r version_ms_median version_ms_p95 < <(bench_repeat 10 -X GET "${version_url}" | bench_stats_ms) || true

  elif [[ "${EFFECTIVE_FLAVOR}" == "lean-public" ]]; then
    read -r version_ms_median version_ms_p95 < <(bench_repeat 10 -X GET "${version_url}" | bench_stats_ms) || true
    notes+=("lean-public: 匿名で叩ける GET のみ（/api/health・/api/version）。login/items/graphql は未計測")
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
  export BENCH_ROUND="${round_idx}" BENCH_ROUNDS_TOTAL="${BENCH_ROUNDS}"

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
    "bench_session_stamp": os.environ.get("STAMP", ""),
    "bench_round": int(os.environ.get("BENCH_ROUND", "1")),
    "bench_rounds_total": int(os.environ.get("BENCH_ROUNDS_TOTAL", "1")),
    "scenarios": {
        # キーは tools/generate-comparison-table.py の ROWS と対応（変更時は両方更新）
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

  echo "[bench] BENCH_API_FLAVOR=${BENCH_API_FLAVOR} effective=${EFFECTIVE_FLAVOR} round=${round_idx}/${BENCH_ROUNDS} -> ${OUT_JSON}"
  cat "${OUT_JSON}"
}

for ((r = 1; r <= BENCH_ROUNDS; r++)); do
  run_one_benchmark_round "${r}"
  if ((r < BENCH_ROUNDS)); then
    sleep "${BENCH_ROUND_SLEEP_SEC}"
  fi
done

#!/usr/bin/env python3
"""benchmarks/results/*.json から API ベンチ用 Markdown 表を出力する。

JSON の `scenarios` キーは benchmarks/run-scenarios.sh の python3 埋め込みと対応。
変更する場合は run-scenarios.sh 側の dict キーと必ず揃えること。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

IMPL_ORDER = ("perf-qwik-rust", "lowspec-qwik-rust", "lean-next-hono")
# (scenarios のキー, 表の行ラベル, 単位)
ROWS = [
    ("health_get_ms_median", "GET /api/health（中央値）※実装により null", "ms"),
    ("health_get_ms_p95", "GET /api/health（p95）", "ms"),
    (
        "login_post_ms",
        "認証レイテンシ（1 回・ms）※graphql-*: GraphQL authLogin／lean-rest: REST POST /api/auth/login",
        "ms",
    ),
    ("items_get_ms_median", "GET /api/items（中央値・Bearer）※lean-rest のみ", "ms"),
    ("items_get_ms_p95", "GET /api/items（p95）", "ms"),
    ("graphql_health_ms_median", "POST /api/graphql query health（中央値）※graphql-only", "ms"),
    ("graphql_health_ms_p95", "POST /api/graphql query health（p95）", "ms"),
    ("graphql_nested_ms_median", "POST /api/graphql items ネスト（中央値）※graphql-only", "ms"),
    ("graphql_nested_ms_p95", "POST /api/graphql items ネスト（p95）", "ms"),
    ("version_get_ms_median", "GET /api/version（中央値）※lean", "ms"),
    ("version_get_ms_p95", "GET /api/version（p95）", "ms"),
    ("health_seq_80_approx_req_per_s", "GET /api/health 連打 80 回・概算 req/s", "req/s"),
]


def fmt_val(v: object, unit: str) -> str:
    if v is None:
        return "—"
    if isinstance(v, (int, float)):
        if unit == "req/s":
            return f"{v:.2f}"
        return f"{v:.3f}"
    return str(v)


def latest_per_impl(results_dir: Path) -> dict[str, dict]:
    best: dict[str, tuple[str, dict]] = {}
    pat = re.compile(r"^(" + "|".join(re.escape(x) for x in IMPL_ORDER) + r")_(\d{8}T\d{6}Z)\.json$")
    for p in sorted(results_dir.glob("*.json")):
        m = pat.match(p.name)
        if not m:
            continue
        impl, stamp = m.group(1), m.group(2)
        prev = best.get(impl)
        if prev is None or stamp > prev[0]:
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            best[impl] = (stamp, data)
    return {k: v[1] for k, v in best.items()}


def emit_table(by_impl: dict[str, dict]) -> str:
    lines = [
        "| シナリオ | " + " | ".join(IMPL_ORDER) + " |",
        "|" + "|".join(["---"] * (1 + len(IMPL_ORDER))) + "|",
    ]
    for key, label, unit in ROWS:
        cells = []
        for impl in IMPL_ORDER:
            data = by_impl.get(impl) or {}
            scen = (data.get("scenarios") or {}) if isinstance(data.get("scenarios"), dict) else {}
            cells.append(fmt_val(scen.get(key), unit))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def emit_readme(by_impl: dict[str, dict]) -> str:
    lines = [
        "",
        "### 表の読み方（比較可否）",
        "",
        "- **perf / lowspec** の列は **`api_flavor: graphql-only`**（または `rust` エイリアス）の結果を想定。**`graphql_*` と認証行（authLogin）**が横比較の主対象。",
        "- **lean-next-hono** は **`lean-rest`** を想定。**`items_get_*`・認証行・`version_*`** が主対象。**`graphql_*` は未実装のため常に —**。",
        "- **—** は「未計測・非対応・2xx なし」のいずれか。詳細は各 JSON の `notes` と `benchmarks/scenarios/API_MATRIX.md`。",
        "",
    ]
    for impl in IMPL_ORDER:
        data = by_impl.get(impl)
        flavor = (data or {}).get("api_flavor", "（不明）")
        lines.append(f"- **{impl}**: 直近 JSON の `api_flavor` = `{flavor}`")
    return "\n".join(lines)


def emit_meta(by_impl: dict[str, dict]) -> str:
    lines = ["", "### メタ（計測ソース・備考）", ""]
    for impl in IMPL_ORDER:
        data = by_impl.get(impl)
        if not data:
            lines.append(f"- **{impl}**: （該当 JSON なし）")
            continue
        stamp = data.get("utc_stamp", "?")
        base = data.get("base_url", "?")
        flavor = data.get("api_flavor", "?")
        notes = data.get("notes") or []
        n = "；".join(notes) if notes else "（備考なし）"
        lines.append(
            f"- **{impl}**: `{impl}_{stamp}.json` · `{base}` · **api_flavor=`{flavor}`** · {n}"
        )
    return "\n".join(lines)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    results = root / "benchmarks" / "results"
    if not results.is_dir():
        print(f"# results なし: {results}", file=sys.stderr)
        return 1
    by_impl = latest_per_impl(results)
    print(emit_table(by_impl))
    print(emit_readme(by_impl))
    print(emit_meta(by_impl))
    return 0


if __name__ == "__main__":
    sys.exit(main())

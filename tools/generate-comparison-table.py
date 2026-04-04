#!/usr/bin/env python3
"""benchmarks/results/*.json から API ベンチ用 Markdown 表を出力する。"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

IMPL_ORDER = ("perf-qwik-rust", "lowspec-qwik-rust", "lean-next-hono")
ROWS = [
    ("health_get_ms_median", "GET /api/health（中央値）", "ms"),
    ("health_get_ms_p95", "GET /api/health（p95）", "ms"),
    ("login_post_ms", "POST /api/auth/login（1 回・Rust 系）", "ms"),
    ("items_get_ms_median", "GET /api/items（中央値・要 Bearer）", "ms"),
    ("items_get_ms_p95", "GET /api/items（p95）", "ms"),
    ("graphql_health_ms_median", "POST /api/graphql health（中央値）", "ms"),
    ("graphql_health_ms_p95", "POST /api/graphql health（p95）", "ms"),
    ("graphql_nested_ms_median", "POST /api/graphql nested（中央値）", "ms"),
    ("graphql_nested_ms_p95", "POST /api/graphql nested（p95）", "ms"),
    ("version_get_ms_median", "GET /api/version（中央値・lean）", "ms"),
    ("version_get_ms_p95", "GET /api/version（p95）", "ms"),
    ("health_seq_80_approx_req_per_s", "health 連打 80 回の概算 req/s", "req/s"),
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


def emit_meta(by_impl: dict[str, dict]) -> str:
    lines = ["", "### メタ（各列の計測ソース）", ""]
    for impl in IMPL_ORDER:
        data = by_impl.get(impl)
        if not data:
            lines.append(f"- **{impl}**: （該当 JSON なし）")
            continue
        stamp = data.get("utc_stamp", "?")
        base = data.get("base_url", "?")
        notes = data.get("notes") or []
        n = "；".join(notes) if notes else "（備考なし）"
        lines.append(f"- **{impl}**: `{impl}_{stamp}.json` · `{base}` · {n}")
    return "\n".join(lines)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    results = root / "benchmarks" / "results"
    if not results.is_dir():
        print(f"# results なし: {results}", file=sys.stderr)
        return 1
    by_impl = latest_per_impl(results)
    print(emit_table(by_impl))
    print(emit_meta(by_impl))
    return 0


if __name__ == "__main__":
    sys.exit(main())

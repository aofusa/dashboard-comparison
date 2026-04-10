# ベンチマークシナリオ

- **API の真実源（実装 × シナリオ）**: [`API_MATRIX.md`](./API_MATRIX.md)
- **実装スクリプト**: `../run-scenarios.sh`（`../lib/bench-lib.sh`・`../lib/bench-env.sh`）

## BASE_URL と backend の整合

- **`run-perf-qwik-rust.sh` / `run-lowspec-qwik-rust.sh`** は、未設定時に各 `apps/*/backend/.env` の **`BIND_ADDR`** と **`BASE_URL` を揃えやすくする**（詳細は [`API_MATRIX.md`](./API_MATRIX.md) の「BASE_URL の決定順序」）。
- **GraphQL ベンチ（`graphql-only`）**は、各バックエンドの **シード済みユーザー**と **`BENCH_EMAIL` / `BENCH_PASSWORD`**（既定 `dev@example.com` / `devpass`）が一致していることが前提。古い **lowspec の `meta.db`** に別パスワードのユーザーのみがあると **authLogin が失敗**し、`graphql_nested_*` が null になり得る（DB リセットは各 `apps/*/README.md` を参照）。

## BENCH_API_FLAVOR（要約）

| flavor | 対象実装 | 説明 |
|--------|----------|------|
| `graphql-only` | perf-qwik-rust、lowspec-qwik-rust | GraphQL のみで認証・一覧相当を計測。REST は使わない。 |
| `rust` | 同上（互換） | `graphql-only` のエイリアス。 |
| `lean-rest` | lean-next-hono | REST login/items + `GET /api/version`。MySQL + `db:seed` 前提。 |
| `lean-public` | lean-next-hono | 匿名 GET のみ（health / version）。 |

## JSON 出力スキーマ（`benchmarks/results/*.json`）

`tools/generate-comparison-table.py` の行と **キー名で対応**しています（変更時は Python 側も更新）。

- `implementation` / `base_url` / `api_flavor` / `utc_stamp`
- `scenarios.*` … `health_get_ms_median` 等（`run-scenarios.sh` 内コメント参照）
- `notes` … 文字列配列（エイリアス・未計測理由など）

## デバッグ

- 非 2xx を stderr に出す場合: **`export BENCH_VERBOSE=1`**（`bench-lib.sh` の `bench_curl_time`）。
- GraphQL **authLogin** の HTTP コードとマスク済みボディ先頭: **`export BENCH_DUMP_AUTH_LOGIN=1`**（`run-scenarios.sh` の `graphql-only` 分岐）。

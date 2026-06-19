# ダッシュボード 3 実装比較（入口）

Monorepo 名は **`dashboard-template`**。**全文仕様**は各 `specs/*-v*.md` を参照してください。

| 実装 | 仕様書 |
|------|--------|
| perf-qwik-rust | `performance-qwik-rust-v1.4.1.md` |
| lowspec-qwik-rust | `lowspec-qwik-rust-v1.5.2.md`（v1.5.1 は v1.5.2 へ誘導） |
| lean-next-hono | `lean-next-hono-v4.1.1.md` |

## クライアント向け API の違い（要約）

| 実装 | 一覧・CRUD の主経路 | 認証の典型 |
|------|----------------------|------------|
| perf-qwik-rust | **`POST /api/graphql` のみ**（REST はバックエンドにあってもクライアント契約は GraphQL 中心） | GraphQL `authLogin` 等 + セッション基盤は README 参照 |
| lowspec-qwik-rust | **同上（GraphQL のみ）** | 同上 |
| lean-next-hono | **REST**（`/api/items` …）+ **OpenAPI** | **`POST /api/auth/login`（JWT）** + Auth.js Cookie（詳細はアプリ README） |

## ベンチマークとの関係

- **対応表（実装 × シナリオ）**: [`benchmarks/scenarios/API_MATRIX.md`](../benchmarks/scenarios/API_MATRIX.md)
- **実装**: [`benchmarks/run-scenarios.sh`](../benchmarks/run-scenarios.sh) · **`BENCH_API_FLAVOR`**: `graphql-only`（perf/lowspec）、`lean-rest`（lean 推奨）、`lean-public`（lean 最小）、`rust`（`graphql-only` のエイリアス）
- **Runbook（コマンド・前提）**: リポジトリ直下 [`README.md`](../README.md) の「ベンチマーク（Runbook）」
- **数値表の生成**: `python3 tools/generate-comparison-table.py`（stdout）。永続化する場合はリダイレクトで `COMPARISON.md` 等へ。

### 表の解釈（短く）

- **横比較しやすい**: perf と lowspecの **`graphql_*` と認証行（GraphQL authLogin）**（同じ `graphql-only` を使用した JSON 同士）。
- **lean 列**: **`lean-rest`** の **`health` / `login` / `items` / `version`**。**`graphql_*` は —**（未実装）。
- **—** の意味は JSON の **`notes`** と API マトリクスで確認。

## その他

- curl ベンチは HTTP **2xx のみ**計測（`benchmarks/lib/bench-lib.sh`）。
- 長文の旧メモ: [`dashboard-comparison_1.0.md`](./dashboard-comparison_1.0.md)（冒頭に現行への誘導あり）。
- 実装対照表: [`artifacts/dashboard-template-implement_20260405.md`](./artifacts/dashboard-template-implement_20260405.md) ＋ 差分 [`artifacts/dashboard-template-implement_20260410.md`](./artifacts/dashboard-template-implement_20260410.md)。
- 計画対現状ギャップ（最新）: [`artifacts/dashboard-template-plan-vs-implement-gap_20260410.md`](./artifacts/dashboard-template-plan-vs-implement-gap_20260410.md)。

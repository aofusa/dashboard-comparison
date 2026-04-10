# ダッシュボード実装比較（Monorepo）

3 実装を同一リポジトリ内で独立させ、`benchmarks/` で HTTP シナリオを揃えて比較します。**仕様の全文**は `specs/` を参照してください（Single Source of Truth）。

| アプリ | 仕様書（全文） |
|--------|----------------|
| perf-qwik-rust | `specs/performance-qwik-rust-v1.4.1.md` |
| lowspec-qwik-rust | `specs/lowspec-qwik-rust-v1.5.2.md` |
| lean-next-hono | `specs/lean-next-hono-v4.1.1.md` |
| 比較の入口 | **`specs/dashboard-comparison.md`**（短い SSOT）／`specs/dashboard-comparison_1.0.md`（歴史的長文・冒頭に現行への誘導） |

## 実装概要

- **perf-qwik-rust**: MySQL（メタ）+ DynamoDB 互換（コンテンツ）+ **クライアント向け HTTP は `POST /api/graphql` のみ**（APQ・depth/complexity）+ **ContentRepository** 抽象 + **Argon2id** + Dragonfly（セッション / 一覧 read-through キャッシュ）+ Arrow（**`ItemsArrowBinary` バイナリ応答**）。Pingora 等は `apps/perf-qwik-rust/README.md` 参照。
- **lowspec-qwik-rust**: **Meta SQLite（WAL + synchronous=NORMAL）** と **Content = 埋め込み DuckDB（`content.duckdb`）** + **mpsc 単一ライター** + **moka weighted** + **Argon2id** + **クライアント向け HTTP は `POST /api/graphql` のみ** + GraphQL **DataLoader** + Arrow（同上・バイナリ分岐）。**REST・`/api/health` は提供しない**。詳細は `apps/lowspec-qwik-rust/README.md`。
- **lean-next-hono**: Next 14（App Router）+ Hono + **Drizzle / MySQL** + **Auth.js（Credentials + JWT セッション）** + **REST**（`/api/health`・認証・items・stats・id-set 等）+ OpenAPI/Swagger。**GraphQL・Arrow は実装しない**（perf/lowspec との比較用に REST 契約を維持）。詳細は `apps/lean-next-hono/README.md`。

`apps/` 間で共有 npm / Rust クレートは置きません。

## 起動（Docker は実行しない場合）

### perf-qwik-rust

インフラ（MySQL / Scylla 等）は**利用者が** `infra/docker-compose.yml` を参照して起動。バックエンドのみ:

```bash
cd apps/perf-qwik-rust/backend && cp .env.example .env && cargo run --release
cd ../frontend && npm install && npm start
```

### lowspec-qwik-rust

```bash
cd apps/lowspec-qwik-rust/backend && cp .env.example .env && cargo run --release
cd ../frontend && npm install && npm start
```

### lean-next-hono

```bash
cd apps/lean-next-hono && cp .env.example .env && npm install && npm run dev
# MySQL 起動後: npm run db:push && npm run db:seed
```

## ベンチマーク（Runbook）

### 公平比較のポリシー（一文）

**perf と lowspec は GraphQL 同士（`graphql-only`）で横比較し、REST 系の数値は lean（`lean-rest`）列のみを主に解釈する。**

### 事前準備

```bash
chmod +x benchmarks/*.sh benchmarks/lib/*.sh
```

- **依存**: `curl`、集計に **`jq`** を推奨（GraphQL の token 抽出）。`python3`（JSON 出力・表生成）。
- **シード**: perf/lowspec は各 README の開発ユーザー（既定 `dev@example.com` / `devpass`）。**lean `lean-rest` は `npm run db:seed` 必須**。
- **オリジン**: lean は **`AUTH_URL` / `NEXTAUTH_URL` とブラウザ・ベンチのホストを一致**（`localhost` と `127.0.0.1` 混在はセッション周りで不具合になり得る）。ベンチは **`BASE_URL` を実際の listen に合わせる**。

### 各実装の前提（既定ポート例）

| 実装 | 既定 `BASE_URL` 例 | `run-*.sh` が設定する `BENCH_API_FLAVOR` |
|------|---------------------|------------------------------------------|
| perf-qwik-rust | `http://127.0.0.1:8080` | `graphql-only` |
| lowspec-qwik-rust | `http://127.0.0.1:8080`（perf と同時なら `8081` 等に変更） | `graphql-only` |
| lean-next-hono | `http://127.0.0.1:3000` または `http://localhost:3000` | `lean-rest` |

### 実行コマンド

```bash
# 個別
./benchmarks/run-perf-qwik-rust.sh
BASE_URL=http://127.0.0.1:8081 ./benchmarks/run-lowspec-qwik-rust.sh
BASE_URL=http://localhost:3000 ./benchmarks/run-lean-next-hono.sh

# 連続（各スクリプトの成否は || true で継続）
./benchmarks/run-all-comparison.sh

# Markdown 表（stdout）
python3 tools/generate-comparison-table.py
```

**lean を匿名 GET のみで測る場合**（DB 不要・軽量）:

```bash
BENCH_API_FLAVOR=lean-public BASE_URL=http://localhost:3000 \
  BENCH_IMPL=lean-next-hono bash benchmarks/run-scenarios.sh
```

（通常は `run-lean-next-hono.sh` が `lean-rest` を設定します。）

### 期待される JSON（`benchmarks/results/<impl>_<UTC>.json`）

- 全 flavor 共通で **`scenarios` のキー集合は同じ**（未計測は `null`）。
- **`api_flavor`**: 実際に使った flavor（`rust` を渡すと JSON には `rust` のまま、挙動は `graphql-only`）。
- **`notes`**: エイリアス説明、スキップ理由など。
- **perf/lowspec（`graphql-only`）**: `graphql_health_*`・`graphql_nested_*`・**`login_post_ms`（GraphQL authLogin）** が主。`items_get_*` は **null**。`GET /api/health` は **null になりがち**（lowspec は REST health なし）。
- **lean（`lean-rest`）**: `health_*`・`login_post_ms`（REST）・`items_get_*`・`version_*` が主。**`graphql_*` は null**。

### デバッグ

```bash
export BENCH_VERBOSE=1
```

### シナリオ対応表（詳細）

**[`benchmarks/scenarios/API_MATRIX.md`](benchmarks/scenarios/API_MATRIX.md)** を参照。

### 関連ドキュメント

- `benchmarks/scenarios/README.md` … flavor 要約・JSON スキーマの索引
- `specs/dashboard-comparison.md` … 比較の読み方・ベンチとの関係
- `specs/artifacts/dashboard-template-plan-vs-implement-gap_20260410.md` … 計画対現状ギャップ（最新版）

## ライセンス

ルートの `LICENSE`（Apache-2.0）を参照。

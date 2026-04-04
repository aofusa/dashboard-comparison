# ダッシュボード実装比較（Monorepo）

3 実装を同一リポジトリ内で独立させ、`benchmarks/` で HTTP シナリオを揃えて比較します。**仕様の全文**は `specs/` を参照してください（Single Source of Truth）。

| アプリ | 仕様書（全文） |
|--------|----------------|
| perf-qwik-rust | `specs/performance-qwik-rust-v1.4.1.md` |
| lowspec-qwik-rust | `specs/lowspec-qwik-rust-v1.5.2.md` |
| lean-next-hono | `specs/lean-next-hono-v4.1.1.md` |
| 比較メモ | `specs/dashboard-comparison_1.0.md` / `specs/dashboard-comparison.md` |

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
# MySQL 起動後: npm run db:push
```

## ベンチマーク

```bash
chmod +x benchmarks/*.sh benchmarks/lib/*.sh
./benchmarks/run-perf-qwik-rust.sh
BASE_URL=http://127.0.0.1:8081 ./benchmarks/run-lowspec-qwik-rust.sh
./benchmarks/run-lean-next-hono.sh
python3 tools/generate-comparison-table.py
```

### ベンチマークと実装の対応

`benchmarks/run-scenarios.sh` の **`BENCH_API_FLAVOR=rust`**（`run-perf-qwik-rust.sh` / `run-lowspec-qwik-rust.sh` が使用）は、**`GET /api/health`・`POST /api/auth/login`・`GET /api/items?...`** を前提にしています。

- **lowspec-qwik-rust / perf-qwik-rust（現行）**: 上記 **REST は削除済み**のため、同スクリプトでは **ヘルス・ログイン・items 行が失敗／未計測**になり得ます。**GraphQL 部分**（`POST /api/graphql` の health / nested items）は現行バックエンドと一致します。
- **lean-next-hono**: **`run-lean-next-hono.sh`** は `BENCH_API_FLAVOR=lean-public` で **`/api/health`・`/api/version`** 中心（items / GraphQL はシナリオから除外）。**手動の REST スモーク**（ログイン・items 等）は `apps/lean-next-hono/README.md` の curl 例どおり利用可能です。

**lowspec / perf の手動スモーク（GraphQL のみ・`BASE_URL` を実際の listen に）**

1. **health**（匿名）:
   ```bash
   BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
   curl -sS -X POST "$BASE_URL/api/graphql" \
     -H 'Content-Type: application/json' \
     -d '{"query":"query { health }"}'
   ```
2. **ログイン**（Mutation・Cookie jar を使う場合は `-c`/`-b` を追加）:
   ```bash
   curl -sS -X POST "$BASE_URL/api/graphql" -H 'Content-Type: application/json' \
     -d '{"query":"mutation { authLogin(email: \"dev@example.com\", password: \"devpass\") { token refreshToken expiresIn } }"}'
   ```
   応答 JSON の `data.authLogin.token` を確認。
3. **items（ページング）**（`TOKEN` を上記から設定）:
   ```bash
   curl -sS -X POST "$BASE_URL/api/graphql" \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"query":"query { items(page: 1, pageSize: 10) { total items { id title user { email } } } }"}'
   ```

シナリオ一覧の表形式まとめは `benchmarks/scenarios/README.md`。ベンチスクリプトの GraphQL 対応は別タスク。計画書と現状表の差分索引は `specs/artifacts/dashboard-template-plan-vs-implement-gap_20260406.md`。

## ライセンス

ルートの `LICENSE`（Apache-2.0）を参照。

# perf-qwik-rust（仕様 `performance-qwik-rust-v1.4.1` との差分は段階的に縮小）

**SSOT（仕様全文）**: `specs/performance-qwik-rust-v1.4.1.md`  
**改修フェーズ（着手順）**: `/mnt/storage/unleash/ai/workspace/perf-qwik-rust_revision_proposal_20260406.md`（**P0** = 本 README・artifact・現状表の同期）

---

## バックエンド（`backend/`）

| 項目 | 実装状況 |
|------|-----------|
| **Axum** | クライアント向けは **`POST /api/graphql` のみ**（`/api/health`・REST `/api/items`・`/api/auth/*` は無し）。 |
| **MySQL** | sqlx + `migrations/`（**`users`** + **`refresh_tokens`**・ハッシュのみ保存）、**Argon2id** |
| **JWT + Refresh + セッション（P4）** | Access は `JWT_ACCESS_EXP_MINUTES`（既定 **15 分**）。Refresh は MySQL + **`JWT_REFRESH_EXP_DAYS`**・**ローテーション**（GraphQL **`authRefresh`**）。**tower-sessions** は **Dragonfly / Redis 互換**（`SESSION_REDIS_URL` …）。**`authLogin`** でセッションに `user_id`。 |
| **一覧キャッシュ（P4b）** | **`items_page_for_user`（GraphQL `items`）のみ** read-through。書き込み後 **`INCR perf:wt:ver:{user_id}`**。**`itemsSlice` / `itemStats` / `itemsUpdatedAfter` / `itemIds` / Arrow 全件はキャッシュしない**。`PERF_CACHE_LIST_ENABLED=false` で Dynamo のみ。 |
| **DynamoDB 互換** | **aws-sdk-dynamodb**。**P1**: **`user_id`（HASH）+ `id`（RANGE）**、**`updated_at`（RFC3339）**。**`itemsUpdatedAfter` / `itemStats` / `itemIds`** は全件走査に近く **高コスト**になり得る。 |
| **GraphQL** | lowspec と揃えた Query / Mutation（**`itemsSlice`**, **`itemsUpdatedAfter`**, **`itemStats`**, **`itemIds`**, **`itemsArrowBinary`**（バイナリ HTTP 分岐）、**`authRefresh` / `authLogout`** 含む）。**APQ**・depth/complexity 制限。 |
| **DataLoader** | **`EmailLoader`** — `GqlItem.user` → `user.email` を **1 回の MySQL `IN` クエリ**で解決（N+1 にはならない）。 |
| **未実装（仕様对照）** | レート制限・OTel（**P7**） |

### GraphQL 早見（すべて `POST /api/graphql`）

- **認証**: Mutation **`authLogin`** / **`authRefresh`**；保護 Query・Mutation は **`Authorization: Bearer`** または **セッション Cookie**（Bearer 優先）。
- **Arrow**: **`operationName`: `ItemsArrowBinary`** + 本文に `query ItemsArrowBinary { itemsArrowBinary }` + **`Accept: application/vnd.apache.arrow.stream; codecs=zstd`**（または `application/x-arrow-ipc+zstd`）。応答は **生バイナリ**。上限 **`ARROW_BINARY_MAX_BYTES`**（0=無制限扱い）。

### curl 例（`BASE` を実際の URL に）

```bash
BASE=http://127.0.0.1:8080

curl -s -c cookies.txt -b cookies.txt -X POST "$BASE/api/graphql" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { authLogin(email: \"dev@example.com\", password: \"devpass\") { token refreshToken expiresIn } }"}'

TOKEN=... # 応答の token

curl -s -X POST "$BASE/api/graphql" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { createItem(title: \"From GQL\") { id title updatedAt user { email } } }"}'

curl -s -X POST "$BASE/api/graphql" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"query { itemStats { total byInitial { letter count } } }"}'
```

---

## フロントエンド（`frontend/`）— **P3**

- **`apps/lowspec-qwik-rust/frontend` を rsync 同期した同一 UI**（`/login/`、`/app/` …）。データ層は **`POST /api/graphql` のみ**（lowspec と **オペレーション文字列・MIME を揃えた** `api.ts` / `auth.ts`）。
- **依存**: lowspec と同様 **`apache-arrow` / `fzstd` / `@duckdb/duckdb-wasm`**。Arrow は **`ItemsArrowBinary` + バイナリ `Accept`** の `fetch` + `arrayBuffer()`。
- **開発**: バックエンド起動後、`cd frontend && npm install && npm start`。`/api` プロキシ先は **`frontend/.env`** の **`BACKEND_URL`** または **`BACKEND_HOST`/`BACKEND_PORT`**（`frontend/.env.example` 参照・既定は `127.0.0.1:8080`）。バックエンドの **`BIND_ADDR`** と揃える。**`vite.config.ts`** の **COOP/COEP**（lowspec 同様・DuckDB Worker 用）。
- **ビルド確認**: `cd frontend && npm run build`。

---

## ローカル依存の起動（Docker・利用者実行）

compose ファイル: **`apps/perf-qwik-rust/infra/docker-compose.yml`**（MySQL・Dragonfly・Scylla + **Alternator** + **`pingora`** リバースプロキシ **:9080**・HTTP/1.1）。

詳細手順・仕様との対応は **`specs/artifacts/perf-qwik-rust-alternator-local_20260406.md`** を参照。

最短例:

```bash
cd apps/perf-qwik-rust/infra
docker compose up -d
# MySQL が healthy になるまで待つ → Scylla Alternator は start_period 最大約 2 分
# pingora は host.docker.internal:8080 を upstream にするため、バックエンドをホストで :8080 起動してから利用
cd ../backend && cp .env.example .env && cargo run --release
```

別ターミナル:

```bash
cd apps/perf-qwik-rust/frontend && npm install && npm start
```

**注意**: 本リポジトリの CI では Docker を起動しません。セッション用に **Dragonfly（Redis プロトコル）へ接続**するため、ローカルでは **`docker compose up -d`** 後にバックエンドを起動するか、`SESSION_REDIS_URL` を実際の Dragonfly/Redis に合わせてください。**P4b** の一覧キャッシュは既定で有効（`PERF_CACHE_LIST_ENABLED`）。Redis に届かない場合は `false` にするか compose を起動してください。

### P4 — Refresh・tower-sessions（セキュリティ一行）

- **ストア**: Refresh は **MySQL `refresh_tokens`**（生トークンは保存せず **SHA-256 ハッシュ**）。セッションは **tower-sessions + `DragonflySessionStore`**（**redis** クレート・Dragonfly/Redis 互換・`SET`/`GET`/`DEL`・`EXAT`）。
- **認可**: GraphQL の保護操作は **`Authorization: Bearer` があれば優先**、なければ **セッションの `user_id`**（フロントは `credentials: "include"` で Cookie を送る）。
- **CSRF**: セッション Cookie を使う **同一オリジン**外からの書き込みを許す場合は **CSRF 対策**（カスタムヘッダー・SameSite 等）を別途検討してください（lowspec README の注意と同趣旨）。

### P4b — 一覧 read-through（Dragonfly / Redis）

- **対象**: `ContentRepository::items_page_for_user` のみ（GraphQL **`items`（ページング）** の Dynamo Query 経路）。**`itemsSlice` 等・Arrow 全件はキャッシュしない**。
- **無効化**: ユーザごと **`INCR {prefix}ver:{user_id}`**（書き込み成功後）。ページキーは `{prefix}page:{user_id}:{ver}:{page}:{page_size}` + **`SET ... EX`**。読み取りで Redis 障害時は Dynamo に **フォールバック**（`tracing` target `perf_cache`）。

### P5a — Pingora リバースプロキシ（一行）

- **実装**: `proxy/` の **`perf_pingora_proxy`**（Pingora 0.8）。**HTTP/1.1 のみ**。**`/graphql` → `/api/graphql`**、**`/api/*` 透過**、**`X-Forwarded-*`**。プロセス設定は **`config/pingora.yaml`**（`-c`）。
- **Docker**: `infra/docker-compose.yml` の **`pingora`** サービス（外向き **:9080** → 既定でホストの **:8080**）。詳細は `proxy/README.md`。
- **開発**: Vite の `/api` プロキシでも可。手元検証は `cargo run -- -c proxy/config/pingora.yaml`。

### P6 — Arrow IPC + Zstd + DuckDB-WASM（一行）

- **バックエンド**: DynamoDB を **Query ページングで全件**読み、`arrow` / `arrow-ipc` で IPC ストリーム → **zstd**。クライアント向けは **`POST /api/graphql`** の **`operationName: ItemsArrowBinary`** + Arrow 用 **`Accept`** で **生バイナリ**応答（lowspec と同 MIME・`Vary: Accept`）。Base64 GraphQL フィールド・**`GET /api/items/arrow`** は **廃止**。
- **フロント**: **`apiItemsArrowBuffer`**（上記 `fetch` + `arrayBuffer()`）→ **fzstd** + **apache-arrow** で `decodeArrowZstdFull` / **`duckdb-app.worker`**（`vite.config.ts` の **COOP/COEP** は lowspec 同様）。

### P1 移行（既存 DynamoDB テーブル）

- **新規**: `ensure_table` がテーブル未作成なら **複合キー**（`user_id` HASH、`id` RANGE）で作成します。seed は `user_id` + `id` + `title` + **`updated_at`** を書き込みます。
- **既存 `DYNAMODB_TABLE` が旧設計**（例: パーティションキーが `id` のみ）の場合、起動時にキー検証で失敗します。**対処はいずれか一方**:
  1. 開発用テーブルを **削除**してからバックエンドを起動し直す（空テーブルが再作成される）。
  2. **別名**のテーブルを用意し、`.env` の **`DYNAMODB_TABLE`** をその名前に変更する（旧データは参照されません）。

---

## ベンチマーク

`benchmarks/run-scenarios.sh`（`run-perf-qwik-rust.sh`）の **REST 系**は現行バックエンドと **非互換**（GraphQL のみのため）。**GraphQL** の `curl` は `POST /api/graphql` で利用可能。手動例は本 README の **curl 例**およびモノレポ直下 `README.md` の **「ベンチマークと実装の対応」** を参照。

---

## 改修の進め方

AI エージェント向けの **フェーズ別指示書**:  
`/mnt/storage/unleash/ai/workspace/perf-qwik-rust_agent_instructions_20260406.md`

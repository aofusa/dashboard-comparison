# lowspec-qwik-rust（仕様 **v1.5.2** 整合）

## バックエンド

- **MetaRepository** → SQLite（`meta.db`）+ **WAL** + **synchronous=NORMAL**、接続は **deadpool-sqlite** + `interact`（仕様どおり deadpool）。
- **ContentRepository** → **Embedded DuckDB（`content.duckdb`）**、**`updated_at`**、**CRUD**（mpsc 単一ライター、読み取りは `spawn_blocking`）。
- **moka** … 一覧の weighted キャッシュ（`MOKA_MAX_BYTES`）。詳細は下記 **「moka キャッシュ境界（Q4）」**（必要に応じて `specs/artifacts/` 配下の比較・ギャップメモも参照）。
- **認証**: Argon2id + **JWT Access**（`JWT_ACCESS_EXP_MINUTES` 既定 15）+ **Refresh**（SQLite `refresh_tokens`、ログイン時にローテーション）+ **tower-sessions**（**moka** バックエンド実装は `session_moka_store.rs`。外部クレートは core 版ずれのため未使用）。
- **HTTP API**: クライアント向けは **`POST /api/graphql` のみ**（REST の `/api/items`・`/api/auth/*`・`/api/health` は提供しない）。**ヘルス**は `query { health }` を同エンドポイントで実行。
- **GraphQL**（`POST /api/graphql`）: Query **`health`**、**`items`**（`page` / `pageSize`）、**`itemsSlice`**（limit/offset）、**`itemsUpdatedAfter`**、**`itemStats`**、**`itemIds`**、スキーマ上の **`itemsArrowBinary`**（実体は下記バイナリ分岐）。Mutation **`authLogin`** / **`authRefresh`** / **`authLogout`** / **`createItem` / `updateItem` / `deleteItem`** + DataLoader（`user.email`）。

### Arrow（バイナリ HTTP 応答）

- **経路**: `POST /api/graphql` に **`operationName: "ItemsArrowBinary"`**、本文に `query ItemsArrowBinary { itemsArrowBinary }`、ヘッダ **`Accept: application/vnd.apache.arrow.stream; codecs=zstd`**（または **`application/x-arrow-ipc+zstd`** / `*/*`）。認可は **`items` と同様**（Bearer またはセッション）。**`Content-Type`** は `Accept` に整合する Arrow Stream + zstd を返す。**`Vary: Accept`** を付与。
- **上限**: 環境変数 **`ARROW_BINARY_MAX_BYTES`**（`0` = 無制限扱い）。超過時は **413**（JSON 本文ではなく短文/plain でも可）。
- **JSON 実行**: `itemsArrowBinary` フィールド単体の通常 GraphQL JSON 応答はエラー（スカラーは型の印のみ）。

手動確認の流れ: `authLogin` でトークン取得 → 上記 `fetch` 相当でバイナリ応答を受け取り **`@apache/arrow` + fzstd** でデコード（フロントと同じ）。

### GraphQL（Q6）— DataLoader と N+1

- **`items` + `items { user { email } }`**: 一覧は **DuckDB へは `count` + `list` の 2 回**（行数 N に比例した N+1 ではない）。`user.email` は **`EmailLoader`** でバッチ化し、SQLite は **`get_emails_by_ids` を 1 クエリ（`IN`）**で解決。
- **調査の SSOT**: `specs/artifacts/lowspec-graphql-dataloader-n1_20260406.md`（現状 **items 経路に N+1 なし**。item 単位の Content 再フェッチフィールドを将来足す場合はバッチ API を設計すること）。

### DuckDB ビルドについて

`duckdb` crate（`bundled`）は **libduckdb** のネイティブビルドを含みます。メモリが少ない環境では **OOM（exit 137）** になり得ます。

- **`backend/.cargo/config.toml`** で **`build.jobs = 1`** を既定化済み（このクレート配下の `cargo build` は並列 1）。`CARGO_BUILD_JOBS` を付けるとそちらが優先されます。
- スワップの確保、または十分な RAM（目安 4GB+）

```bash
cd backend && cp .env.example .env && cargo run --release
```

`Cargo.toml` の **`[profile.release]`**（`lto = "thin"`, `codegen-units = 1`）でリリース最適化。**HTTP/3 は対象外**。

### moka キャッシュ境界（Q4）

| 経路 | キャッシュ |
|------|------------|
| `list_items`（GraphQL `items` / `itemsSlice` の一覧本体） | **あり**。キー `{user_id}:{limit}:{offset}`。値は `(total, rows)` を保持し呼び出しには `rows` のみ返す。 |
| `count_items` | **なし**（一覧取得時に inner と併せて使うが、キャッシュエントリの構築用）。 |
| `list_items_updated_after` | **なし**（差分は常に最新）。 |
| `item_title_initial_stats`（GraphQL `itemStats`） | **なし**。 |
| `list_item_ids`（GraphQL `itemIds`） | **なし**（削除同期は常に最新）。 |

**書き込み**（`create` / `update` / `delete`）成功後は **`invalidate_all`**。キー単位無効化は moka に prefix API が無く実装コスト対効果が低いため **現状維持**（判断は上記メモ「Q4 照合」）。フロントのマルチタブ同期は **キャッシュをバイパスする API** に依存するため、一覧キャッシュと整合しない状態にはならない。

## フロントエンド

Qwik（`frontend/` で `npm start`）。`/api` は Vite プロキシ（`vite.config.ts`）。接続先は `frontend/.env` の **`BACKEND_URL`**（フル URL）または **`BACKEND_HOST`** + **`BACKEND_PORT`**（既定 `127.0.0.1:8080`）。バックエンドの **`BIND_ADDR`** と揃える。テンプレは `frontend/.env.example`。

| ルート | 内容 |
|--------|------|
| `/` | トップ |
| `/login/` | メール・パスワード → JWT（例: `dev@example.com` / `devpass`） |
| `/app/` | アイテム一覧（フィルタ・ソート・**仮想スクロール**・CRUD モーダル・集計バー・フォーカス時同期） |

**マルチタブ同期（Q2）**: ウィンドウフォーカス時に (1) GraphQL **`itemsUpdatedAfter`** で他タブ・他クライアントによる**追加・更新**をマージし、(2) **`itemIds`** の id 集合でローカルにあってサーバに無い行を**削除**（物理削除の伝播）。順序は常に (1)→(2)。集計バーはいずれかで一覧が変わったときだけ **`itemStats`** を再取得。

**データ取得（Q1）**: 一覧・集計は **`routeLoader$`（`useAppDashboardLoader`）** で、リクエストの **Cookie** を付けて SSR / SPA 遷移時に **`POST /api/graphql`**（`AppDashboardLoader`: `itemsSlice` + `itemStats`）。セッション Cookie が無い／401 のときだけクライアントで **Bearer（localStorage）** による `reload` にフォールバック。計測手順は `specs/artifacts/lowspec-app-perf-notes_20260406.md`。

### UI（仕様 v1.5.2）

**全文仕様**: `specs/lowspec-qwik-rust-v1.5.2.md`。フロントは **Qwik UI Styled Kit** を正とし、**Park UI・Ark UI・Panda CSS は採用しない**。

| 項目 | 内容 |
|------|------|
| **公式ドキュメント** | [Qwik UI — Styled Kit](https://qwikui.com/docs/styled/install) |
| **本リポジトリの実装状況** | **`npx qwik-ui init` は非対話向けで使わず**、Tailwind v4（`@tailwindcss/vite`）＋ **`@qwik-ui/headless`** ＋公式 Styled に近い **`src/components/ui`**（Button / Input / Label / Modal）を手動配置。テーマ変数・`@theme` は `src/global.css`（monorepo 専用の `@source` はなし）。主要ルート（`/`・`/login/`・`/app/`）は上記コンポーネントとトークン系ユーティリティに寄せ済み。 |

補足記録: `specs/artifacts/lowspec-ui-stack-spec_20260406.md`（仕様変更の索引）。

**Arrow + Zstd + DuckDB-WASM**: 「Arrow 取得」は **`POST /api/graphql`**（`ItemsArrowBinary` + Arrow 用 `Accept`）で **生バイナリ**を受け取り、**fzstd** + **apache-arrow** でプレビュー。展開済み IPC は **OPFS** に保存を試行（対応ブラウザのみ）。「DuckDB で照会」は **専用 Worker**（`src/workers/duckdb-app.worker.ts`）内で **@duckdb/duckdb-wasm** を実行。開発サーバは **COOP/COEP** を付与（`vite.config.ts`）。初回 wasm は数秒・`dist` に大容量 wasm を含みます。

```bash
cd frontend && npm install && npm start
# 別ターミナルで backend を起動してから /login/ → /app/
```

**自動テスト（フロント）**: `frontend/README.md` の「Tests（lowspec フロント）」を参照。`cd frontend && npm run test:unit`（バックエンド不要）、`npm run test:e2e`（**バックエンド起動後**・初回は `npm run test:e2e:install` で Chromium 取得）。

## ベンチマークとの整合

`benchmarks/run-scenarios.sh`（`BENCH_API_FLAVOR=rust`）は **REST ログイン・GET items** を前提とするため、**現行バックエンドとは一部非互換**です。手動確認は **GraphQL** の `curl` を使ってください（モノレポ直下 `README.md` の「ベンチマークと実装の対応」）。**REST でのベンチ・curl 比較**は **lean-next-hono** が担当します。計画書と現状表の差分は `specs/artifacts/dashboard-template-plan-vs-implement-gap_20260406.md`。

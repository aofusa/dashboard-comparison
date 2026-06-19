# performance-qwik-rust v1.4（要約・復元用）

## 目的

Qwik City + Rust（Axum）で、**外部 MySQL（メタ）**、**Redis/Dragonfly（セッション・リストキャッシュ）**、**DynamoDB 互換 API（Scylla Alternator 等）**を用いた高スループットダッシュボード API。

## API（ベンチ整合）

- `GET /api/health`
- `POST /api/auth/login` → JSON `{ "token": "..." }`
- `GET /api/items?page=&pageSize=` + `Authorization: Bearer`
- `POST /api/graphql`（`health` / `items { total items { id title user { email } } }`）

## GraphQL 強化

- **Apollo Persisted Queries（APQ）**: `async-graphql` の APQ 拡張 + LRU。
- **depth / complexity**: `limit_depth` / `limit_complexity` およびフィールド `complexity` 属性。
- 環境変数例: `GRAPHQL_MAX_DEPTH`, `GRAPHQL_MAX_COMPLEXITY`, `GRAPHQL_APQ_CACHE_SIZE`。

## インフラ

`apps/perf-qwik-rust/infra/docker-compose.yml`: MySQL 8、Dragonfly、Scylla（Alternator :8000）。

## 備考

オプションで Pingora リバースプロキシ（`proxy/`）を挟む構成を想定。

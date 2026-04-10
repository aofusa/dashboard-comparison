# API マトリクス（実装 × ベンチシナリオ）

`run-scenarios.sh` の **`BENCH_API_FLAVOR`** と、各アプリが実際に提供する API の対応です。計測の可否は **2xx のみ採用**（`benchmarks/lib/bench-lib.sh`）です。

## 凡例

| 記号 | 意味 |
|------|------|
| ○ | その flavor で **計測する**（値が JSON に入り得る） |
| × | **計測しない**（常に `null`） |
| △ | **実装次第**（例: `GET /api/health` が無いと中央値が null） |

## マトリクス

| シナリオ（JSON キー相当） | perf-qwik-rust | lowspec-qwik-rust | lean-next-hono |
|---------------------------|----------------|-------------------|----------------|
| **GET /api/health**（`health_get_*`） | △ クライアント向けは GraphQL が主で **GET は無いか非2xx** になりがち | × **REST health なし**（null） | ○ `lean-rest` / `lean-public` |
| **POST /api/auth/login**（`login_post_ms`） | × REST ログインはベンチ **未使用**（`graphql-only`） | × 同上 | ○ `lean-rest`（**`login_post_ms`**） |
| **GraphQL authLogin**（同一 `login_post_ms`） | ○ **`graphql-only` で計測**（注: キー名は歴史的に `login_post`） | ○ 同上 | × |
| **GET /api/items**（`items_get_*`） | × `graphql-only` では未計測 | × 同上 | ○ `lean-rest` |
| **POST /api/graphql health**（`graphql_health_*`） | ○ `graphql-only` | ○ 同上 | × 未実装 |
| **POST /api/graphql nested items**（`graphql_nested_*`） | ○ Bearer 要 | ○ 同上 | × |
| **GET /api/version**（`version_get_*`） | × | × | ○ `lean-rest` / `lean-public` |
| **health 連打 80**（`health_seq_*`） | △ GET health が2xxなら有効 | △ 同上 | ○ |

## BENCH_API_FLAVOR 一覧

| 値 | 用途 | 主な計測 |
|----|------|----------|
| **`graphql-only`** | perf / lowspec（**推奨**） | GraphQL health（匿名）・authLogin（`login_post_ms`）・nested items |
| **`rust`** | **後方互換** | `graphql-only` と同一（JSON の `notes` にエイリアス宣言） |
| **`lean-rest`** | lean（**推奨**） | GET health・REST login・REST items・GET version |
| **`lean-public`** | lean 最小 | GET health・GET version のみ（認証系は null） |

## 公平比較について

- **GraphQL 同士**（perf vs lowspec）は **`graphql-only`** の **`graphql_*` と `login_post_ms`（authLogin）** で横並び可能。
- **REST**（login/items）は **lean `lean-rest`** の列のみ意味が明確。perf/lowspec は REST をクライアント向けに提供しない前提。
- **`GET /api/health`** の数値は実装によって null になり得る。**ライブネス**は GraphQL `health` クエリを参照（perf/lowspec）。

詳細なコマンド例は **リポジトリ直下 `README.md` の「ベンチマーク（Runbook）」** を参照してください。

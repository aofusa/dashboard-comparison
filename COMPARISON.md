# 3 実装 比較

`benchmarks/run-scenarios.sh` の同一シナリオで計測。未計測は `—`。仕様全般については `specs/system-specification.md` を参照してください。

## API ベンチマーク

```bash
python3 tools/generate-comparison-table.py
```

**注意**: タイミングは HTTP **2xx のみ**。`BASE_URL` は API が直接 2xx を返す向きに指定する。

| シナリオ | perf-qwik-rust | lowspec-qwik-rust | lean-next-hono |
|---|---|---|---|
| GET /api/health（中央値）※実装により null | — | — | 16.288 |
| GET /api/health（p95） | — | — | 35.634 |
| 認証レイテンシ（1 回・ms）※graphql-*: GraphQL authLogin／lean-rest: REST POST /api/auth/login | 529.744 | 295.011 | 926.391 |
| GET /api/items（中央値・Bearer）※lean-rest のみ | — | — | 44.772 |
| GET /api/items（p95） | — | — | 52.941 |
| POST /api/graphql query health（中央値）※graphql-only | 5.178 | 1.956 | — |
| POST /api/graphql query health（p95） | 13.553 | 3.181 | — |
| POST /api/graphql items ネスト（中央値）※graphql-only | 19.681 | 140.875 | — |
| POST /api/graphql items ネスト（p95） | 28.648 | 204.424 | — |
| GET /api/version（中央値）※lean | — | — | 11.429 |
| GET /api/version（p95） | — | — | 16.453 |
| GET /api/health 連打 80 回・概算 req/s | — | — | 54.83 |

### 表の読み方（比較可否）

- **perf / lowspec** の列は **`api_flavor: graphql-only`**（または `rust` エイリアス）の結果を想定。**`graphql_*` と認証行（authLogin）**が横比較の主対象。
- **lean-next-hono** は **`lean-rest`** を想定。**`items_get_*`・認証行・`version_*`** が主対象。**`graphql_*` は未実装のため常に —**。
- **—** は「未計測・非対応・2xx なし」のいずれか。詳細は各 JSON の `notes` と `benchmarks/scenarios/API_MATRIX.md`。
- **複数ラウンド**（`*_rNN.json`）がある場合、本表は **同一セッション内の最終ラウンド**を採用（`latest_per_impl_and_paths` の選定ロジック）。

- **perf-qwik-rust**: 直近 JSON の `api_flavor` = `graphql-only`
- **lowspec-qwik-rust**: 直近 JSON の `api_flavor` = `graphql-only`
- **lean-next-hono**: 直近 JSON の `api_flavor` = `lean-rest`

### メタ（計測ソース・備考）

- **perf-qwik-rust**: `perf-qwik-rust_20260619T151013Z.json` · `http://127.0.0.1:9080` · **api_flavor=`graphql-only`** · graphql-only: GET /api/health は実装により null になり得る。認証は GraphQL authLogin。REST login/items は未計測；login_post_ms は GraphQL authLogin（1 回・片道 ms; HTTP 2xx 時は GraphQL errors があっても計測）
- **lowspec-qwik-rust**: `lowspec-qwik-rust_20260619T151029Z.json` · `http://127.0.0.1:28080` · **api_flavor=`graphql-only`** · graphql-only: GET /api/health は実装により null になり得る。認証は GraphQL authLogin。REST login/items は未計測；login_post_ms は GraphQL authLogin（1 回・片道 ms; HTTP 2xx 時は GraphQL errors があっても計測）
- **lean-next-hono**: `lean-next-hono_20260619T151043Z.json` · `http://127.0.0.1:3000` · **api_flavor=`lean-rest`** · lean-rest: REST login/items + GET /api/version。GraphQL は未実装のため graphql_* は null

## サマリー（ブラウザ・主観）

| 項目 | perf-qwik-rust | lowspec-qwik-rust | lean-next-hono |
|------|----------------|-------------------|----------------|
| 初回ロード p95 (ms) | 未計測 | 未計測 | 未計測 |
| 再アクセス p95 (ms) | 未計測 | 未計測 | 未計測 |
| スループット | 高 (複数ノードスケール可) | 中 (単一ノード完結) | 中 |
| メモリ (MB) | 高 (各種インフラコンテナ) | 低 (moka cache制御, DB組込) | 中 (Node.jsプロセス) |
| 起動〜健全 OK (s) | 遅い (Scylla/MySQL初期化待機) | 速い | 中程度 (DBコンテナ起動待機) |
| 開発生産性 (1–5) | 2 (Rust + 複数ミドルウェア) | 3 (Rust + 組込DB構成) | 5 (TypeScript統一, Next.js) |
| 運用保守性 (1–5) | 2 (複数コンテナの運用監視が必要) | 4 (依存インフラなし) | 4 (標準的なWebスタック) |
| 外部依存 | MySQL, ScyllaDB, Dragonfly, Pingora | なし (Embedded DuckDB / SQLite) | MySQL |

## 結果ファイル

- `benchmarks/results/<実装>_<UTC>.json`

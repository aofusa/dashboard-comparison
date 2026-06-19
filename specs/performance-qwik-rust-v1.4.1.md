**システム設計書・仕様書**  
**プロジェクト名**: Qwik City + **Qwik UI（Styled Kit）** アプリケーション（パフォーマンス最優先版）  
**バージョン**: **1.4.1**（2026年4月 マルチDB対応・DynamoDB互換版・フロント UI 記述更新）  
**改訂理由**: 1.3版の極限性能基盤を維持しつつ、**コンテンツ管理DBの環境別切り替え**に対応。  
- **フロント UI は Qwik UI Styled Kit** を正とする。**Park UI・Ark UI・Panda CSS は採用しない**（[Styled Kit 導入](https://qwikui.com/docs/styled/install)）。  
- ローカル開発環境：**ScyllaDB (Alternatorモード)**  
- テスト／本番環境：**AWS DynamoDB**  

これを実現するため、**ScyllaDB Alternator（DynamoDB互換API）**を活用した「Alternateモード」を明記。  
Rustバックエンドでは**Repositoryパターン**による抽象化レイヤーを導入し、DynamoDB風API（PutItem/GetItem/Query/BatchWriteItemなど）で両環境をシームレスに切り替え可能に。  
開発体験の統一、移行リスクの最小化、クエリモデリングの共通化を実現。  
パフォーマンス目標（初回ロード < 400ms、再アクセス < 20ms）は維持しつつ、運用柔軟性を大幅に向上。

**目的**: 環境ごとのDB違いを意識せずに開発・運用可能にし、**Single Source of Truth**をさらに強固に。  
**対象**: AIエージェントへの指示用最新版。

---

### 1. システム概要（更新）
- **コンセプト**: 「Resumability（Qwik） + 低レイテンシRust単一バックエンド + 多層キャッシュ + 計算資源の完全分散 + 環境別DB抽象化」  
- **画面構成**: 認証画面 + データテーブル（一覧・フィルタ・ソート・ページング・集計・仮想化） + モーダル（追加／編集／削除）  
- **主な機能**:  
  - ログイン／ログアウト（JWT中心）  
  - コンテンツCRUD（DuckDB優先高速表示 + インクリメンタル更新）  
- **パフォーマンス目標**（1.4版維持）:  
  - 初回ロード: **< 400ms**（Zstd Arrow IPC + Web Worker + COI + バックグラウンドハイドレーション）  
  - 再アクセス: **< 20ms**（OPFS永続化 + インクリメンタル部分更新）  
  - 高負荷時: DynamoDB / ScyllaDB線形スケール + Dragonflyマルチスレッド + DataLoader

---

### 2. 改訂後アーキテクチャ全体図（1.4版・マルチDB対応）
```
[ブラウザ (Qwik City + Qwik UI Styled Kit)]
    │
    │ DuckDB-WASM (Arrow IPC + Zstd圧縮 + OPFS永続化 + Web Worker / COI)
    │   └─ useVisibleTask$ + routeLoader$ + incremental hydration / 部分更新
    │
[Pingora (Rust製プロキシ・コード実装)]
    │   QUIC 0-RTT（オプション・Anti-replay対策付き） + HTTP/3
    │
    ├── GraphQL単一エンドポイント（/graphql）
    │     │
    │     └── Dragonfly (マルチスレッドキャッシュ)
    │           │
    │           ├── 認証系 (JWT中心)
    │           └── コンテンツ系 (一覧/CRUD + 部分更新)
    │
[Rust単一バックエンド (Axum + async-graphql)]
    │   Write-throughキャッシュ更新 + Zstd Arrow IPC出力
    │   └─ 認証: JWT中心（短寿命Access Token） + tower-sessions（Refresh Token補助） + argon2 + jsonwebtoken
    │      + async-graphql-dataloader（N+1排除）
    │      └─ **Content Repository抽象化レイヤー**（DynamoDB互換API）
    │
    ├── Meta DB: MySQL (or TiDB)
    └── **Content DB**:
         ├── ローカル開発: ScyllaDB (Alternatorモード)
         └── テスト/本番: AWS DynamoDB
```

---

### 3. コンポーネント別仕様（1.4版）

| コンポーネント          | 採用技術（1.4版）                                   | 役割・理由（パフォーマンス／セキュリティ／運用視点） |
|-------------------------|----------------------------------------------------|-----------------------------------------------|
| **リバースプロキシ**    | **Pingora (Rustコード実装)**                       | HTTP/3 + QUIC 0-RTT（オプション） + Anti-replay |
| **フロントエンド**      | **Qwik City + Qwik UI Styled Kit**<br>+ graphql-request<br>**DuckDB-WASM + OPFS + Web Worker + COI** + Zstd Arrow | Resumability + ゼロコピー + メインスレッド非ブロック + 転送量30-60%削減。Park/Ark/Panda は不採用。 |
| **バックエンド**        | **Rust単一**<br>Axum + async-graphql + dataloader | 完全統合 + N+1排除 + Write-through |
| **認証処理**            | **jsonwebtoken**（Access Token中心） + **tower-sessions**（Refresh Token補助、Dragonflyバックエンド）<br>+ **argon2** (Argon2id) | JWT中心でDragonfly読み込み回数激減。tower-sessionsでセッション共有。 |
| **GraphQL**             | async-graphql（code-first） + **async-graphql-dataloader** + Automatic Persisted Queries + complexity/depth limit | N+1完全排除 + クエリ保護 + Arrow IPCレスポンス |
| **キャッシュ層**        | **Dragonfly**                                      | 認証／コンテンツ + Write-through + 部分更新トピック |
| **アカウントDB**        | **MySQL (or TiDB)**                                | ユーザー管理（トランザクション） |
| **コンテンツDB**        | **ScyllaDB (Alternatorモード)**（ローカル開発）<br>**AWS DynamoDB**（テスト/本番） | 開発時はScyllaDB AlternatorでDynamoDB API完全互換。本番はネイティブDynamoDB。同一コードで動作。 |
| **DBアクセスレイヤー**  | **Repositoryパターン**（DynamoDB互換API抽象化）<br>aws-sdk-dynamodb または Scylla Alternator対応クライアント | 環境切り替え（config / feature flag）で同一クエリを使用。 |
| **シリアライズ**        | **Apache Arrow IPC + Zstd圧縮**                    | パースコストほぼゼロ + 転送量削減 |
| **クライアント永続化**  | **OPFS**                                           | DuckDB永続化 + インクリメンタル更新 |

---

### 4. 認証処理の詳細仕様（1.3版から変更なし）
- **方針**: セキュリティ最優先。JWT中心にシフト（レイテンシ最適化）。  
- **採用構成**:  
  - **メイン**: jsonwebtoken（Access Token: 15分短寿命）  
  - **補助**: tower-sessions（Dragonflyバックエンド）でRefresh Token回転管理  
  - **パスワード**: argon2（Argon2id）  
  - **GraphQL統合**: AuthSession / CurrentUser + DataLoaderをContextに注入  
- **フロー**:  
  1. login mutation → argon2検証 → Access Token発行 + Refresh Token（HttpOnly Cookie）  
  2. 保護Query/Mutation → JWT検証（axum extractor）  
  3. ログアウト → Refresh Token無効化（Dragonfly）  
- **セキュリティベストプラクティス**:  
  - Access Token: 15分短寿命  
  - Refresh Token: HttpOnly / Secure / SameSite=Strict + 回転  
  - Rate limiting: tower-http / governor  
  - Mutation成功時: Dragonfly Write-through即時更新  

---

### 5. コンテンツDB詳細仕様（新設セクション）
- **環境別構成**:
  - **ローカル開発環境**: ScyllaDB Dockerコンテナ + **Alternatorモード**（DynamoDB互換API）有効化  
    - 推奨起動オプション: `--alternator-port=8000 --alternator-write-isolation=only_rmw_uses_lwt`  
    - DynamoDB API（JSON over HTTP）でアクセス可能。本番に極めて近い開発体験を提供。
  - **テスト / 本番環境**: AWS DynamoDB（ネイティブ）
- **互換性方針**: ScyllaDB **Alternator** を使用することで、**aws-sdk-dynamodb をほぼそのまま利用**可能。  
  - アプリケーションコードは**DynamoDB風API**（PutItem, GetItem, Query, Scan, BatchWriteItem, ConditionExpression, UpdateItemなど）で統一。  
  - ScyllaDB Alternatorの未サポート機能は公式互換性ドキュメントを確認し、代替手段で対応。
- **データモデリング**: **query-driven modeling + denormalization** を徹底（DynamoDBベストプラクティス準拠）。  
  - Partition Key / Sort Key設計をDynamoDB基準で統一。  
  - ScyllaDBのshard-awareメリットはAlternator経由でも一部享受可能。
- **Rust実装方針**:
  - **抽象化**: `ContentRepository` trait を定義（例: `save()`, `find_by_pk_sk()`, `query_by_gsi()`, `batch_write()` など）。  
  - 実装: `DynamoDbRepository`（aws-sdk-dynamodb使用）とローカル用実装（endpoint_urlをScyllaDB Alternatorに切り替え）。  
  - 切り替え方法: 環境変数（`CONTENT_DB_ENDPOINT` など）または feature flag でクライアントのendpointと認証情報を動的に設定。  
  - 推奨: aws-sdk-dynamodb をメインクライアントとし、ローカル時は `.endpoint_url("http://localhost:8000")` でScyllaDB Alternatorに接続。
- **キャッシュ連携**: Dragonfly Write-through + `updated_at` によるインクリメンタル更新（変更なし）。
- **パフォーマンス考慮**: Alternatorモード時はScyllaDBの高スループットを活かし、本番DynamoDBのレイテンシを想定したクエリ設計を行う。

---

### 6. キャッシュ戦略詳細（1.4版強化）
**フロント（DuckDB-WASM + Zstd + OPFS） ← Pingora edge cache ← Dragonfly ← Content DB（Scylla Alternator or DynamoDB）**  
- 更新時（mutation）は**Write-through厳守** + `updated_at`返却 → フロントでインクリメンタル部分更新  
- 部分更新専用トピック（Dragonfly）で不要な全再ロードを回避

---

### 7. パフォーマンスをさらに尖らせるための+α（1.4版）
- **DB抽象化**: Repositoryパターンにより、DB切り替え時のパフォーマンス劣化を最小限に抑える（同一クエリパス）。  
- **ローカル最適化**: ScyllaDB Alternator + Dockerで本番に近い高速開発環境を実現。  
- **監視**: OpenTelemetry + tracing で DBレイヤーも含めたエンドツーエンドトレース。

---

### 8. 実装上の注意点・対策（更新）
- **Alternator有効化**: Docker起動時に `--alternator-port` と write-isolation オプションを必ず指定。  
- **互換性確認**: ScyllaDB Alternatorの未実装APIや挙動差異（公式ドキュメント参照）を事前検証。特にトランザクション系は注意。  
- **Repository抽象化**: すべてのGraphQL resolver / service層は `ContentRepository` trait 経由でアクセス（環境非依存コード）。  
- **テスト戦略**: ローカルはScyllaDB Alternator、本番寄り統合テストはDynamoDB LocalまたはScyllaDBで実施。  
- **移行容易性**: 将来DynamoDBからScyllaDB本番に移行する場合も最小変更で済むよう設計。  
- **セキュリティ**: DynamoDB IAMロール / ScyllaDB認証を環境ごとに適切に設定。  
- **DuckDB-WASM**: Web Worker + COI必須（メインスレッドブロック回避）。

---

### 9. 実装時のAIエージェント指示用チェックリスト（1.4版）
1. Rustバックエンド → **ContentRepository抽象化 + DynamoDB互換API**（aws-sdk-dynamodb中心、ScyllaDB Alternator対応） + JWT中心認証 + async-graphql-dataloader + Zstd Arrow IPC出力 + Write-through Dragonfly連携  
2. ScyllaDBローカル → **Alternatorモード有効化**（Docker compose設定例含む） + query-drivenデータモデル（Partition Key / Sort Key設計）  
3. 環境切り替え → 環境変数 / config / feature flag でローカル(Scylla Alternator) ↔ 本番(DynamoDB) をシームレスに  
4. Qwik City側 → DuckDB-WASMをWeb Worker + COI + Zstd Arrow対応 + routeLoader$ + インクリメンタル更新  
5. GraphQL Code Generator更新 → DataLoader + complexity limit + Arrow IPCスカラー + 認証ペイロード対応  
6. **Qwik UI Styled Kit** の Data Table 相当＋モーダル → 仮想化 + DuckDB SQL優先 + updated_atインクリメンタルトリガー  
7. 認証画面 → login mutation + JWT Cookie処理 + Refresh回転  
8. 監視 → OpenTelemetry + tracing（DBレイヤー含む）

**この1.4.1版（文書名 `performance-qwik-rust-v1.4.1.md`）が最新の Single Source of Truth**です。  
ScyllaDB Alternator（Alternateモード）を活用することで、**開発環境と本番環境のコード・クエリを統一**し、開発効率と運用負荷を大幅に低減します。

**AIエージェントに次に指示したい部分**（推奨順）:
- 「RustバックエンドのContentRepository抽象化 + DynamoDB互換API実装（ScyllaDB Alternator対応含む）を生成せよ」
- 「ScyllaDB AlternatorモードのDocker compose.yml + ローカル起動スクリプトを生成せよ」
- 「GraphQL resolverをRepository trait経由にリファクタリングせよ」

さらに修正が必要、または特定部分の詳細展開が必要でしたら即時対応します！ 🚀
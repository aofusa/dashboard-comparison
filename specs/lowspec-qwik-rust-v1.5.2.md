**システム設計書・仕様書**  
**プロジェクト名**: Qwik City + **Qwik UI（Styled Kit）** アプリケーション（Low-Spec Local Optimized Edition）  
**バージョン**: **1.5.2**（2026年4月 低スペック単一端末完全埋め込み版・フロント UI スタック明文化）  
**改訂理由**: v1.5.1 を継承しつつ、フロントの UI 層を **Qwik UI Styled Kit** に統一して記述する。  
- **Park UI・Ark UI・Panda CSS は採用しない**（依存・テーマ・コンポーネントの前提から除外）。  
- 画面実装は **[Qwik UI — Styled Kit](https://qwikui.com/docs/styled/install)** を正とし、テーブル・モーダル・フォーム等は同キットのパターンに沿う。  
v1.5.1 の Meta DB 分離・mpsc・moka weighted・WAL 等のバックエンド方針は変更しない。

**目的**: 低スペック端末でも「最大限のパフォーマンス」を発揮し、開発体験を最高レベルに向上。Single Source of Truthをさらに強固に。  
**対象**: AIエージェントへの指示用最新版（低スペックローカル専用）。

---

### 1. システム概要（1.5.2版更新）
- **コンセプト**: 「Resumability（Qwik） + 低レイテンシRust単一プロセス + Embedded DuckDB（Content） + Embedded SQLite（Meta） + In-processキャッシュ + 完全ゼロ外部依存」  
- **画面構成**: 認証画面 + データテーブル（一覧・フィルタ・ソート・ページング・集計・仮想化） + モーダル（追加／編集／削除）  
- **UI 層**: **Qwik City + Qwik UI Styled Kit**（[ドキュメント](https://qwikui.com/docs/styled/install)）。Park UI / Ark UI / Panda CSS は使用しない。  
- **主な機能**:  
  - ログイン／ログアウト（JWT中心）  
  - コンテンツCRUD（DuckDB優先高速表示 + インクリメンタル更新）  
- **パフォーマンス目標**（1.5.1版強化を維持）:  
  - 初回ロード: **< 400ms**（Zstd Arrow IPC + Web Worker + COI + バックグラウンドハイドレーション）  
  - 再アクセス: **< 10ms**（OPFS永続化 + インクリメンタル部分更新 + ネットワークホップ0）  
  - 低スペック高負荷時: Embedded DuckDBのベクター化 + moka weighted cache + DataLoader + mpsc制御

---

### 2. 改訂後アーキテクチャ全体図（1.5.2版・Low-Spec Local版・Meta DB分離）
```
[ブラウザ (Qwik City + Qwik UI Styled Kit)]
    │
    │ DuckDB-WASM (Arrow IPC + Zstd圧縮 + OPFS永続化 + Web Worker / COI)
    │   └─ useVisibleTask$ + routeLoader$ + incremental hydration / 部分更新
    │
[Rust単一バイナリ (Axum + async-graphql)]
    │   In-process only（HTTP/3直接）
    │   ├── In-process Cache (moka - weighted size)
    │   ├── Embedded DuckDB (Content DB)
    │   │     └─ 書き込み: mpsc channel (単一ライター)
    │   ├── Embedded SQLite (Meta DB - WALモード)
    │   ├── ContentRepository trait（DuckDB実装）
    │   ├── MetaRepository trait（SQLite実装）
    │   ├── JWT認証 + async-graphql-dataloader
    │   └── Write-through + Zstd Arrow IPC
```

---

### 3. コンポーネント別仕様（1.5.2版更新）

| コンポーネント          | 採用技術（1.5.2版）                                      | 低スペックでの理由・効果 |
|-------------------------|-------------------------------------------------------|-------------------------|
| **Content DB**          | **Embedded DuckDB**（duckdb-rs crate、bundled） + mpsc channel書き込み制御 | 列指向・ベクター化で分析クエリが爆速。mpscで書き込みをシーケンシャル化しロック競合を防止。 |
| **Meta DB**             | **Embedded SQLite**（rusqlite + deadpool） + WALモード | OLTPに最適。WAL + synchronous=NORMALで低スペック端末でも書き込み性能と並列読み取りを確保。 |
| **DBアクセスレイヤー**  | **Rust Repositoryパターン**（ContentRepository / MetaRepository） | 抽象化を維持（将来クラウド移行容易）。 |
| **キャッシュ**          | **moka crate**（async concurrent cache + weighted size） | 外部プロセス排除 + バイトベースメモリ制限でOOMを厳格に防止。 |
| **バックエンド**        | **Rust単一バイナリ** Axum + async-graphql + dataloader | コンテキストスイッチ0、起動爆速。 |
| **リバースプロキシ**    | **なし**（Axum直接HTTP/3）                            | オーバーヘッド完全排除。 |
| **認証処理**            | **jsonwebtoken** + **tower-sessions**（mokaバックエンド） + **argon2** + MetaRepository | 低スペックでも安全・高速。 |
| **GraphQL**             | async-graphql（code-first） + **async-graphql-dataloader** | N+1排除 + Arrow IPCレスポンス。 |
| **シリアライズ**        | **Apache Arrow IPC + Zstd圧縮**                    | 転送量削減・パースコストほぼゼロ。 |
| **フロント UI**         | **Qwik City + Qwik UI Styled Kit**（[@qwik-ui/styled](https://qwikui.com/docs/styled/install) 系） | Qwik ネイティブコンポーネント。**Park UI・Ark UI・Panda CSS は採用しない**。DataTable／モーダル等は Styled Kit の推奨パターンで仮想化・フォームを構成。 |

---

### 4. 認証処理の詳細仕様（1.5.1版から変更なし）
- **方針**: セキュリティ最優先を維持。  
- **採用構成**: jsonwebtoken（Access Token: 15分短寿命） + tower-sessions（mokaバックエンド） + argon2（Argon2id） + MetaRepository経由でSQLiteアクセス。  
- **フロー**: 1.4版と同一。  
- **低スペック対応**: moka + WALモードのSQLiteで安定した認証処理を実現。

---

### 5. データベース詳細仕様（1.5.1版・強化版）
- **Content DB（分析・コンテンツ用）**:
  - **技術**: Embedded DuckDB（duckdb-rs bundled）
  - **永続化**: `content.duckdb`（実装ファイル名。旧版で `content.db` と記載されていた場合は本版を正とする）
  - **書き込み制御**: **mpsc channel** を使用し、書き込み操作（Insert/Update/Delete）を単一タスクでシーケンシャル実行。読み取りはconnection poolで並列化。
  - **用途**: 大量行のフィルタ・ソート・集計・ページング・仮想化 + `updated_at`インクリメンタル更新。
  - **実装**: `ContentRepository` trait → `DuckDBContentRepository`（SQL → Arrow RecordBatch → Zstd）。
- **Meta DB（アカウント・認証用）**:
  - **技術**: Embedded SQLite（rusqlite + deadpool）
  - **永続化**: `meta.db`
  - **設定（必須）**: 接続時に `PRAGMA journal_mode=WAL;` と `PRAGMA synchronous=NORMAL;` を実行（低スペック端末での書き込み性能向上と読み書き並列性確保）。
  - **用途**: ユーザー管理・ログイン・パスワード検証・Refresh Token管理。
  - **実装**: `MetaRepository` trait → `SQLiteMetaRepository`。
- **キャッシュ連携**: moka Write-through + `updated_at`インクリメンタル更新（weighted sizeでメモリ制限）。
- **パフォーマンス考慮**: DuckDBは分析特化、SQLiteはOLTP特化 + mpsc/WALで低スペック環境に最適化。

---

### 6. キャッシュ戦略詳細（1.5.1版強化）
**フロント ← Axum ← moka (weighted size) ← (Content: DuckDB / Meta: SQLite)**  
- moka構築時に **weigher** と **max_capacity** を使用し、実際のバイトサイズベースで厳格にメモリ使用量を制限（例: メタデータ全体で200MB以内など環境変数で制御）。  
- 更新時はWrite-through厳守。

---

### 7. パフォーマンスをさらに尖らせるための+α（1.5.1版）
- **DuckDB書き込み**: mpsc channelで単一ライターを実現 → ロック競合ゼロ。  
- **SQLite**: WALモード + synchronous=NORMALでディスクI/Oを最適化。  
- **moka**: weighted sizeでメモリを厳格管理 → 低RAM環境でも安全。  
- **Rustビルド**: `--release --features bundled-duckdb,bundled-sqlite` + LTO + codegen-units=1。  
- **リソース制限**: 環境変数でキャッシュサイズ・DuckDB memory_limitを設定。  
- **監視**: OpenTelemetryはオプショナル（低スペックでは無効化推奨）。

---

### 8. 実装上の注意点・対策（1.5.2版）
- **Docker完全不要**: `cargo run`のみ。  
- **Repository抽象化**: すべてのresolverはtrait経由。  
- **DuckDB書き込み**: mpsc channel必須（sqlx不採用）。  
- **SQLite初期化**: 接続時にWAL + synchronous=NORMALを必ず実行。  
- **moka**: サイズ意識（weigher）でメモリ制限を厳格に。  
- **低スペックチューニング**: OOM防止とディスクI/O最適化を最優先。  
- **テスト戦略**: ローカル完結（Embedded DBのみ）。  
- **フロント**: **Qwik UI Styled Kit** を前提とする。**Park UI / Ark UI / Panda CSS は導入しない**。

---

### 9. 実装時のAIエージェント指示用チェックリスト（1.5.2版）
1. Rustバックエンド → **Embedded DuckDB (Content + mpsc書き込み) + Embedded SQLite (Meta + WAL) + moka (weighted size)** + 両Repository抽象化 + JWT + async-graphql-dataloader + Zstd Arrow IPC  
2. DuckDB統合 → `duckdb-rs`（bundled）でContentRepository実装 + mpsc channelによる書き込み制御 + Arrow export  
3. SQLite統合 → `rusqlite` + `deadpool`でMetaRepository実装（WAL + synchronous=NORMAL必須） + tower-sessions連携  
4. キャッシュ → **moka** Write-through + weigherによるweighted size制限  
5. Qwik City側 → **Qwik UI Styled Kit** による画面構成 + DuckDB-WASM + Web Worker + COI + インクリメンタル更新  
6. GraphQL resolver → 両Repository trait経由にリファクタリング  
7. **データテーブル（Qwik UI）** → 仮想化 + DuckDB SQL優先 + `updated_at` トリガー（ParkUI 表記は廃止）  
8. 認証画面 → login mutation + JWT + Refresh回転（MetaRepository対応）  
9. 低スペックチューニング → mpsc/WAL/weighted size + メモリ制限設定 + バイナリ最適化

**この1.5.2版が低スペックローカル端末における最新のSingle Source of Truth**です。  
フロントは **Qwik UI Styled Kit** に統一し、Park / Ark / Panda 依存を仕様上排除しました。

**AIエージェントに次に指示したい部分**（推奨順）:  
- 「設計書1.5.2に基づき、ContentRepository (DuckDB + mpsc) と MetaRepository (SQLite + WAL) のTrait定義＋最小Axumバックエンド実装を生成せよ（bundled機能有効、sqlx不採用）」  
- 「moka weighted size + DuckDB mpsc制御の詳細実装を生成せよ」  
- 「フロントを Qwik UI Styled Kit 前提に置き換え・依存追加せよ」

さらに修正や詳細展開が必要でしたら、すぐに指示してください。

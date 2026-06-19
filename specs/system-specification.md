# Dashboard Template System Specification (Consolidated)

この仕様書は複数の過去の仕様書を統合した最新の仕様書です。

## Overview and Comparison

### Source: dashboard-comparison.md

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


---

### Source: dashboard-comparison_1.0.md

> **注意（2026-04）**  
> 本ファイルは**歴史的・長文の設計メモ**です。リポジトリ名（例: `dashboard-comparison` 表記）、仕様書の版番号、ディレクトリ案などが**現行モノレポと一致しない箇所**があります。  
> **比較の入口（現行）**: [`dashboard-comparison.md`](./dashboard-comparison.md) · 仕様全文は `specs/performance-qwik-rust-v1.4.1.md` 等 · 実装対照は [`artifacts/dashboard-template-implement_20260405.md`](./artifacts/dashboard-template-implement_20260405.md) および [`artifacts/dashboard-template-implement_20260410.md`](./artifacts/dashboard-template-implement_20260410.md) · ギャップ索引は [`artifacts/dashboard-template-plan-vs-implement-gap_20260410.md`](./artifacts/dashboard-template-plan-vs-implement-gap_20260410.md)。

---

**了解しました！**

新しい設計書（**Qwik City + Qwik UI Styled Kit Low-Spec Local Optimized Edition v1.5.x**）を**第3の比較対象**として正式に追加します。

これで比較対象は以下の**3実装**になります：
- **perf-qwik-rust**（v1.3：外部DB・多層キャッシュ・高スケーラビリティ重視）
- **lowspec-qwik-rust**（v1.5：低スペック単一端末完全埋め込み版・Embedded DuckDB + SQLite + moka）
- **lean-next-hono**（v4.1：開発効率・保守性最優先・シンプル構成）

---

### 更新後のMonorepo構成（3実装比較版）

```bash
dashboard-comparison/                          ← リポジトリ名
├── README.md
├── COMPARISON.md                              # ← 3実装の比較表に更新
├── specs/
│   ├── performance-qwik-rust-v1.3.md          # 最初の仕様書
│   ├── lowspec-qwik-rust-v1.5.md              # ← 新規追加（今回提供された全文）
│   └── lean-next-hono-v4.1.md
│
├── apps/
│   ├── perf-qwik-rust/                        # v1.3（外部DB版）
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── proxy/
│   │   ├── infra/
│   │   └── benchmarks/
│   │
│   ├── lowspec-qwik-rust/                     # ← 新規追加（v1.5 Low-Spec Embedded版）
│   │   ├── frontend/                          # Qwik City + Qwik UI Styled Kit（lowspec）
│   │   ├── backend/                           # Rust単一バイナリ（Embedded DuckDB + SQLite + moka）
│   │   ├── infra/                             # （Docker不要だが、必要なら最小構成）
│   │   └── benchmarks/
│   │
│   └── lean-next-hono/                        # v4.1（シンプル版）
│       ├── app/
│       ├── nginx/
│       ├── infra/
│       └── benchmarks/
│
├── benchmarks/                                # 3実装を公平比較する共通ベンチマーク
│   ├── scenarios/
│   ├── results/
│   ├── run-perf-qwik-rust.sh
│   ├── run-lowspec-qwik-rust.sh               # ← 新規追加
│   ├── run-lean-next-hono.sh
│   └── run-all-comparison.sh
│
├── tools/
│   └── generate-comparison-table.py
│
├── .github/workflows/
└── .gitignore
```

---

**AIエージェントにそのままコピー＆ペーストして渡せる最新指示文**（これをそのまま使ってください）

---

**AIエージェントへの指示（コピーして使用してください）**

あなたは優秀なフルスタックエンジニアです。

私は「Qwik City + Rust」系統の2種類（高パフォーマンス版と低スペック埋め込み版）と「Next.js + Hono」版の**合計3つのダッシュボードアプリ**を、**Monorepoで完全に独立した状態**で実装し、公平に性能比較したいと考えています。

### 1. リポジトリ全体構成（厳守）

以下の構成でMonorepoを作成してください。**apps/配下の3プロジェクトは一切依存関係を持たせない**（共有パッケージ、共通型、共有UIなどは一切作らない）。

```bash
dashboard-comparison/
├── README.md
├── COMPARISON.md
├── specs/
│   ├── performance-qwik-rust-v1.3.md
│   ├── lowspec-qwik-rust-v1.5.md          # ← 最新のLow-Spec Embedded版
│   └── lean-next-hono-v4.1.md
│
├── apps/
│   ├── perf-qwik-rust/                    # v1.3（外部DB・多層キャッシュ版）
│   ├── lowspec-qwik-rust/                 # v1.5（低スペック単一端末完全埋め込み版）
│   └── lean-next-hono/                    # v4.1（シンプル開発効率版）
│
├── benchmarks/                            # 3実装を同一条件で比較
│   ├── scenarios/
│   ├── results/
│   ├── run-perf-qwik-rust.sh
│   ├── run-lowspec-qwik-rust.sh
│   ├── run-lean-next-hono.sh
│   └── run-all-comparison.sh
│
├── tools/
│   └── generate-comparison-table.py
│
├── .github/workflows/
└── .gitignore
```

### 重要なルール（厳守）

- 3つのアプリは**完全に独立**（それぞれ独自の `package.json` / `Cargo.toml` を持ち、依存関係を一切共有しない）
- `packages/` フォルダは作成しない
- `pnpm-workspace.yaml` や `turbo.json` は必須ではない（作成する場合も依存混在を避ける）
- ベンチマークは `benchmarks/` 配下の共通スクリプトからHTTPリクエストを投げる（3実装すべて同一シナリオで実行）

### 作業の進め方（推奨順序）

1. **まず apps/lean-next-hono** を v4.1 に忠実に実装（最も早く動く）
2. **次に apps/lowspec-qwik-rust** を v1.5 に忠実に実装（低スペック埋め込み版）
3. **最後に apps/perf-qwik-rust** を v1.3 に忠実に実装
4. 3つすべてが動いたら、同一ベンチマークを実行して `COMPARISON.md` に結果をまとめる

### 最初にやってほしいこと

以下のファイルをまず作成してください：

1. リポジトリのルートに上記のフォルダ構成を作成（空フォルダでOK）
2. `specs/` フォルダに、提供した**3つの仕様書全文**をそれぞれのファイル名で保存
3. `README.md` にプロジェクト目的、3実装の概要、起動手順の雛形、ベンチマーク進め方を記載
4. `COMPARISON.md` のテンプレートを作成（比較項目：初回ロード時間、再アクセス時間、高負荷スループット、メモリ使用量、起動時間、開発生産性、運用保守性など）

その後、**「まず lean-next-hono 版のプロジェクト雛形を作成せよ」** と指示を出してください。

---

この指示文をAIエージェントに渡せば、3実装すべてが正しく配置され、比較準備が整います。

必要であれば：
- `COMPARISON.md` の3実装比較テンプレート
- 各アプリの最小構成ファイル例（`Cargo.toml` や `package.json`）
- ベンチマークスクリプトの更新版

もすぐに用意します。  
このまとめ方で進めましょうか？ それとも調整点がありますか？

---

## Lean Next Hono (v4.1.1)

### Source: lean-next-hono-v4.1.1.md

承知いたしました。パフォーマンスの追求から始まり、最終的に**「最小のインフラ構成で最大の開発効率を叩き出す」**という、実戦的で非常にバランスの取れた着地点になりましたね。

「Nginxは維持する」という要件を加えつつ、HonoをNext.jsに統合し、複雑なキャッシュ層を削ぎ落とした**最終的な「真・プラグラマティック仕様書（v4.1）」**をまとめます。

---

# システム設計書・仕様書 (v4.1)

**プロジェクト名**: Next.js + Hono 統合ダッシュボード (Standard & Lean版)
**改訂理由**: 
1. **極限の簡略化**: Redis、DuckDB-WASM、自前JWT、分離バックエンドをすべて廃止。
2. **開発効率の最大化**: Next.jsのRoute HandlersにHonoを統合し、1つのリポジトリ・1つのプロセスで完結。
3. **保守性の向上**: Auth.jsの採用により認証をライブラリ化。インフラをNginx + App + MySQLの3要素に集約。
4. **型安全の継承**: Hono RPC + Zodにより、フロント〜DBまでTypeScriptの型を完全同期。

---

## 1. システム概要
- **コンセプト**: 「1つの言語、1つのプロセス、1つのDB」で運用負荷を最小化。
- **ターゲット**: Java/Spring Boot経験者とNext.js経験者が、共通の型定義（Zod）で迷いなく開発できる環境。
- **インフラ構成**: Nginxをプロキシに据えつつ、アプリケーション本体は単一ユニットとして動作。

---

## 2. アーキテクチャ全体図



```mermaid
graph TD
    User([ユーザー]) --> Nginx[Nginx (Reverse Proxy / SSL)]
    Nginx --> NextApp[Next.js App (Next.js + Hono Integrated)]
    
    subgraph NextApp
        direction TB
        Frontend[Frontend: shadcn/ui + TanStack Query]
        Auth[Auth: Auth.js / NextAuth.js]
        API[Backend: Hono Route Handlers]
    end

    API --> MySQL[(MySQL)]
    API --- Drizzle[Drizzle ORM]
    NextApp --- Zod[[Zod: Shared Schemas]]
```

---

## 3. コンポーネント別仕様

| コンポーネント | 採用技術 | 選定理由（保守・効率視点） |
| :--- | :--- | :--- |
| **リバースプロキシ** | **Nginx** | 標準的なパスルーティング、SSL終端、CORS制御、レート制限。 |
| **フロントエンド** | **Next.js (App Router)** | **TanStack Query**を採用。複雑な独自キャッシュを廃止し、標準機能で完結。 |
| **バックエンド** | **Hono (Integrated)** | **Next.jsのRoute Handlers上で動作**。単一リポジトリ・単一ポートで動作し、管理が容易。 |
| **API仕様・ドキュメント**| **@hono/zod-openapi** | 実装と同時にSwagger UIを自動生成。Java経験者への安心感を提供。 |
| **認証** | **Auth.js (NextAuth.js)** | **自前実装を廃止**。セッション管理、セキュリティ、ソーシャル連携をライブラリに一任。 |
| **ORM / DB** | **Drizzle ORM + MySQL** | 型安全かつSQLライク。インフラをMySQL1つに絞り、Redis等のミドルウェアを排除。 |
| **型安全・バリデーション** | **Zod** | DB・API・フロントのすべてのスキーマを統合管理。 |

---

## 4. 開発・運用戦略 (シンプル版)

### ① キャッシュ戦略の簡略化
- **Redis 廃止**: 代わりにNext.jsのタグ付きキャッシュ (`unstable_cache`) と MySQLのインデックス設計を徹底。
- **TanStack Query**: クライアント側の「再取得（staleTime）」設定だけで実用的な体感速度を確保。

### ② 認証フロー
- **Auth.js**: セッション情報をDB（MySQL）に保存するか、Cookie（JWT）ベースで管理。自前の暗号化ロジック（argon2等）を最小化。

### ③ API連携
- **Hono RPC**: フロントエンドからは `import { client } from "@/lib/api"` のように、バックエンドの型を直接参照してフェッチ。

---

## 5. 実装時のAIエージェント指示用チェックリスト

1. **統合プロジェクト構成**: `app/api/[[...route]]/route.ts` に Hono をマウントするNext.jsのディレクトリ構造を作成せよ。
2. **Auth.js セットアップ**: データベースアダプター（DrizzleAdapter）を用いた Auth.js の基本設定を実装せよ。
3. **Drizzle Schema 定義**: MySQL用のテーブル定義を作成し、`drizzle-zod` を用いて Zod スキーマを抽出せよ。
4. **Hono + OpenAPI 実装**: `packages/api` 的な役割を Next.js 内に作成し、Swagger UI が `/api/swagger` で表示されるようにせよ。
5. **Nginx 設定ファイル**: ポート 3000 (Next.js) へのプロキシ、静的ファイルのキャッシュ、CORS設定を含む `nginx.conf` を作成せよ。
6. **Docker Compose**: `app (Next.js)`、`db (MySQL)`、`proxy (Nginx)` の3サービスで構成される `docker-compose.yml` を作成せよ。

---

### 最終レビューコメント
「削ぎ落とす」ことで、**「何がどこで動いているか」が誰の目にも明らかな構成**になりました。
Nginxを残したことで、将来的に静的配信を強化したり、特定のパスを別のマイクロサービスに振ったりする拡張性も担保されています。

この設計書をコピーしてAIエージェントに渡し、まずは **「1. Honoを統合したNext.jsのプロジェクト雛形と、Drizzle/MySQLの初期接続」** から実装をスタートさせてください。

これで進めましょう！応援しています！ 🚀

---

### Source: lean-next-hono-v4.1.md

# lean-next-hono v4.1（要約・復元用）

## 目的

Next.js App Router + **Hono** で API を統合し、開発効率と保守性を優先。MySQL + Prisma/Drizzle 等は仕様に合わせて追加可能。

## 公開 API（ベンチ整合）

- `GET /api/health`
- `GET /api/version`

認証付き items/GraphQL は NextAuth 等が必要なため、共通ベンチの Rust 系シナリオとは切り分け（`BENCH_API_FLAVOR=lean-public`）。


---

## Lowspec Qwik Rust (v1.5.2)

### Source: lowspec-qwik-rust-v1.5.2.md

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


---

### Source: lowspec-qwik-rust-v1.5.1.md

> **この版は参照用に保持します。最新の lowspec 全文仕様は [lowspec-qwik-rust-v1.5.2.md](./lowspec-qwik-rust-v1.5.2.md) を Single Source of Truth としてください。**
>
> **v1.5.2 での主な変更**: フロント UI を **Qwik UI Styled Kit** に統一し、仕様上 **Park UI・Ark UI・Panda CSS の採用をやめました**。

---

（以下、v1.5.1 当時の本文は v1.5.2 にマージ済みのため省略。履歴検索が必要な場合は Git を参照してください。）


---

### Source: lowspec-qwik-rust-v1.5.md

# lowspec-qwik-rust v1.5（要約・復元用）

## 目的

低スペック単一端末向け。**SQLite（メタ・アプリデータ）**、**埋め込み DuckDB（分析）**、プロセス内 **moka** キャッシュで外部サービスなし運用を目指す。

## API

perf 版と同一の REST/GraphQL シナリオに揃え、`benchmarks/run-scenarios.sh` がそのまま使えること。

## フロント

Qwik City + **Qwik UI Styled Kit**（Park UI / Ark UI / Panda CSS は仕様上採用しない。本復元では最小ルートのみでも可）。

## バックエンド

単一 Rust バイナリ、`BIND_ADDR` で待受。DuckDB はオプション（未使用でもビルド可能な構成にできる）。


---

## Performance Qwik Rust (v1.4.1)

### Source: performance-qwik-rust-v1.4.1.md

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

---

### Source: performance-qwik-rust-v1.4.md

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


---


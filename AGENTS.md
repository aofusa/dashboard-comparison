# AI Agent Guidelines (dashboard-template)

このリポジトリは3種類（perf-qwik-rust, lowspec-qwik-rust, lean-next-hono）のダッシュボード実装を比較・ベンチマークするMonorepoです。AIエージェントとして開発を支援する際は以下のルールに従ってください。

## 1. プロジェクト構造と独立性
- `apps/` 配下にある3つのプロジェクト（`perf-qwik-rust`, `lowspec-qwik-rust`, `lean-next-hono`）は完全に独立しています。
- これらアプリ間でパッケージや依存関係、UIコンポーネント（Park UI、Ark UIなど）を共有してはいけません。
- 新しい機能やライブラリを追加する際は、必ず対象のプロジェクト（`apps/` 以下の特定ディレクトリ）のみを変更してください。

## 2. 実装の原則
- **perf-qwik-rust**:
  - クライアント通信は `POST /api/graphql` のみ。
  - バックエンドはRust。DBはScyllaDB (DynamoDB互換) と MySQL。Dragonflyをキャッシュに用いる。
  - フロントエンドは Qwik City + Qwik UI Styled Kit。Park UI / Ark UI / Panda CSS は利用禁止。
- **lowspec-qwik-rust**:
  - `POST /api/graphql` のみ。REST APIは提供しない。
  - バックエンドはRust。DBは Embedded DuckDB (コンテンツ用, mpscで単一ライター制御) と Embedded SQLite (メタ用, WALモード)。
  - moka weighted cache を用いてメモリ使用量を厳格に管理する。
  - フロントエンドは Qwik City + Qwik UI Styled Kit。Park UI / Ark UI / Panda CSS は利用禁止。
- **lean-next-hono**:
  - Next.js App Router + Hono統合バックエンド。REST API (`/api/items` など) と OpenAPI/Swagger。
  - GraphQLやArrowは用いない。
  - 認証はAuth.js (Credentials + JWTセッション) を用いる。DBはMySQL + Drizzle ORM。

## 3. ベンチマーク
- ベンチマークの変更やテストスクリプト (`benchmarks/`) を修正する際は、`BENCH_API_FLAVOR` の整合性を意識してください（`graphql-only` vs `lean-rest`）。
- 評価の際は、各アプリの起動手順やポートの競合（BIND_ADDRとBASE_URL）に注意してください。

## 4. 仕様書の参照
- 仕様全般については `specs/system-specification.md` を唯一の正 (Single Source of Truth) として参照してください。過去の仕様書はここに統合されています。
- `specs/artifacts` 配下はAI生成物や分析結果などを置く場所であり、Gitの追跡対象外 (`.gitignore` 指定) です。ここに仕様の変更を加えないでください。

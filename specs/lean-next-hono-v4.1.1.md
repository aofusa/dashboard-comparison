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
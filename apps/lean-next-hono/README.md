# lean-next-hono（仕様 `lean-next-hono-v4.1.1` ＋性能テスト整合）

モノレポ内の **perf-qwik-rust / lowspec-qwik-rust** は **クライアント API が `POST /api/graphql` のみ**です。本アプリは **REST**（`/api/health`・認証・items 等）を維持し、ベンチの公開エンドポイント計測・手動 `curl` と整合させています。

- **Next.js 14**（App Router）+ **Hono 4**（`src/app/api/[[...route]]/route.ts`）。
- **Auth.js / next-auth v5（beta）** + **`@auth/drizzle-adapter`** + **MySQL** 上の `user` / `account` / `session` / `verificationToken` 表。
- **Credentials** ログイン: メール・パスワードは **`user.password_hash`**（bcrypt）。セッションは **`strategy: "jwt"`**（Credentials と DB セッション併用不可のため）。
- **性能テスト整合（明示的逸脱）**: **`POST /api/auth/login|refresh|logout`** で **Access JWT + Refresh（MySQL に SHA-256 ハッシュのみ保存）**。仕様 v4.1.1 の「自前 JWT 廃止」とは別系統だが、**perf/lowspec と同じ REST 認証契約**を取るため追加している。
- **実装しない（依頼スコープ）**: **GraphQL**、**一覧のサーバ側 read-through キャッシュ**、**Arrow IPC / `/api/items/arrow`**、**DuckDB-WASM / Worker / OPFS**。データは **MySQL のみ**（`item` / `refresh_token` を含む）。
- **shadcn/ui** + **TanStack Query** + **`@tanstack/react-virtual`**（`/app` の仮想スクロール）。
- **OpenAPI** + **`/api/swagger`**。

## 前提（環境変数）

- **`DATABASE_URL`** … **必須**（実行時。`src/db/index.ts`）。
- **`AUTH_SECRET`**（または **`NEXTAUTH_SECRET`**）… Auth.js および **JWT 署名**のフォールバック秘密鍵。
- **`JWT_SECRET`**（任意）… 設定時は Access JWT の署名に **優先**して使う。
- **`JWT_ACCESS_EXP_MINUTES`**（既定 `15`）、**`JWT_REFRESH_EXP_DAYS`**（既定 `7`）。
- **`AUTH_URL` / `NEXTAUTH_URL`** … オリジン（例: `http://localhost:3000`）。

`next build` 時に `DATABASE_URL` が無い CI 向けに、`next.config.mjs` でプレースホルダ接続文字列と `AUTH_SECRET` を補うことがあります（**本番では必ず実接続と本番秘密鍵を設定**すること）。

## 開発手順

```bash
cp .env.example .env
# .env の DATABASE_URL / AUTH_SECRET を編集

docker compose -f infra/docker-compose.yml up -d db   # 例

npm install
npm run db:push
npm run db:seed
npm run dev
```

1. ブラウザで `http://localhost:3000` → **ログイン**（`dev@example.com` / `devpass` は `db:seed` 後）。
2. ログイン時は **`POST /api/auth/login`** でトークンを **localStorage** に保存したうえで、**Auth.js `signIn`** により Cookie セッションも確立します。
3. **`/app`** … 仮想スクロール一覧・CRUD モーダル・**`GET /api/items/stats`** の集計バー・ウィンドウ **フォーカス時**に **`updated_after` → `id-set`** の順でマルチタブ同期。
4. API ドキュメント: **`/api/swagger`**（OpenAPI JSON は **`/api/openapi.json`**）。

## マイグレーション方針

- 開発は **`drizzle-kit push`**（`npm run db:push`）。本番では `drizzle-kit generate` による SQL 管理への移行可。
- 旧雛形の `users` 表のみの DB は Auth.js 用表と競合し得るため、空 DB または別 DB を推奨。

## npm scripts

| script | 内容 |
|--------|------|
| `db:push` | Drizzle Kit でスキーマを DB に反映 |
| `db:seed` | 開発ユーザー＋**サンプル item 12 件**（既存 item があるユーザーはスキップ） |
| `db:studio` | Drizzle Studio |
| `test:e2e` | Playwright（`tests/e2e/playwright.config.js`・`webServer` で `next dev`） |
| `test:e2e:ui` | Playwright UI モード |
| `test:e2e:install` | Chromium バイナリ取得（初回のみ推奨） |

## E2E（Playwright）

- **前提**: MySQL 起動済み、`DATABASE_URL` 有効、**`npm run db:push`** と **`npm run db:seed`** 済み（`dev@example.com` / `devpass`）。
- **オリジン整合**: 既定の `baseURL` / webServer は **`http://localhost:3000`**。**`AUTH_URL` / `NEXTAUTH_URL` も同じホスト**にしてください（`localhost` と `127.0.0.1` の混在は Auth.js の CSRF で失敗しうる）。別 URL で動かす場合は `PLAYWRIGHT_BASE_URL` も合わせる。
- **初回**: `npm run test:e2e:install`
- **実行**: `npm run test:e2e`（`tests/e2e/playwright.config.js` が **`npm run dev`** を起動。`3000` が既に使用中なら既存サーバを再利用する場合あり）
- **生成物**: `tests/e2e/.auth/dev.json`（setup で作成。**`.gitignore` 済み**）

## 認可の優先順位（保護 API）

1. **`Authorization: Bearer <Access JWT>`**（性能テスト・curl 互換で第一）
2. 無い場合は **Auth.js の JWT セッション Cookie**（`next-auth/jwt` の `getToken` で解決）

## REST（curl 例）

`BASE=http://localhost:3000` とする。

```bash
# ログイン → token / refresh_token / expires_in（秒）
curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"devpass"}'

# アイテム一覧（ページング）
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/items?page=1&pageSize=10"

# limit / offset（page 系が無いとき）
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/items?limit=5&offset=0"

# updated_after（ISO8601）
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/items?updated_after=2020-01-01T00:00:00.000Z"

# 集計（空タイトルは先頭文字をスペース 1 文字として集約）
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/items/stats"

# 全 id（削除同期用）
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/items/id-set"

# 作成（201）
curl -sS -X POST "$BASE/api/items" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"hello"}'

# 更新（200）
curl -sS -X PUT "$BASE/api/items/$ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"world"}'

# 削除（204）
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/api/items/$ID" \
  -H "Authorization: Bearer $TOKEN"

# Refresh ローテーション
curl -sS -X POST "$BASE/api/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}"

# ログアウト（当該ユーザーの Refresh 全削除・204）
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/auth/logout" \
  -H "Authorization: Bearer $TOKEN"
```

## 手動受け入れ（マルチタブ）

1. ブラウザでログインし **`/app`** を開く。
2. 別タブで同アカウントを開き、一方でアイテムを追加・編集・削除。
3. もう一方のタブでウィンドウにフォーカスを戻すと、**差分マージと id-set による欠落削除**が走る（TanStack Query のキャッシュ更新）。

## 性能テスト・ベンチ向けメモ

- **BASE_URL 例**: `http://localhost:3000`（`AUTH_URL` / `NEXTAUTH_URL` とホストを揃える。`npm run dev` / `npm start` の listen に合わせる）。
- モノレポの **`benchmarks/run-lean-next-hono.sh`** は **`BENCH_API_FLAVOR=lean-rest`**（REST login・items・`GET /api/version`）。**`db:seed` 済み**が前提。対応表は **`benchmarks/scenarios/API_MATRIX.md`**、手順はルート **`README.md` の「ベンチマーク（Runbook）」**。
- **GraphQL・Arrow IPC・DuckDB 関連シナリオは本アプリの対象外**。REST（`/api/health`・認証・items・stats・id-set）が比較の主対象。

## 仕様チェックリスト（進捗）

| 項目 | 状態 |
|------|------|
| Hono を `app/api/[[...route]]` にマウント | 済 |
| Auth.js + DrizzleAdapter + Credentials | 済 |
| **REST JWT login / refresh / logout**（Route Handlers） | 済 |
| **`item` / `refresh_token` 表** + シード items | 済 |
| **items REST**（ページング・limit/offset・updated_after・stats・id-set・CRUD） | 済 |
| **Bearer 優先 + Cookie フォールバック**（Hono） | 済 |
| @hono/zod-openapi + Swagger | 済 |
| `/app` 仮想スクロール・CRUD モーダル・stats・フォーカス同期 | 済 |
| TanStack Query + `unstable_cache` 例（トップ） | 済 |

### Credentials とセッション戦略について

Auth.js では **Credentials と database セッションを同時に使えない**ため **`session: { strategy: "jwt" }`** としています。ダッシュボード API 呼び出しは **localStorage の Bearer** を主とし、401 時に **`/api/auth/refresh`** を試行します。ログアウト時は **`/api/auth/logout`** で Refresh を失効させ、**`signOut`** で Cookie を消します。

## 公開 API（抜粋）

- `GET /api/health` / `GET /api/version`
- `POST /api/auth/login` / `POST /api/auth/refresh` / `POST /api/auth/logout`
- `GET|POST /api/items`、`PUT|DELETE /api/items/:id`、`GET /api/items/stats`、`GET /api/items/id-set`

## スタイル（globals.css）

`shadcn/tailwind.css` はパッケージ未同梱のため `@import` していません。テーマ変数は `globals.css` の `:root` を参照してください。

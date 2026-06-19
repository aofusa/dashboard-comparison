# lean-next-hono v4.1（要約・復元用）

## 目的

Next.js App Router + **Hono** で API を統合し、開発効率と保守性を優先。MySQL + Prisma/Drizzle 等は仕様に合わせて追加可能。

## 公開 API（ベンチ整合）

- `GET /api/health`
- `GET /api/version`

認証付き items/GraphQL は NextAuth 等が必要なため、共通ベンチの Rust 系シナリオとは切り分け（`BENCH_API_FLAVOR=lean-public`）。

# Qwik City App ⚡️

- [Qwik Docs](https://qwik.dev/)
- [Discord](https://qwik.dev/chat)
- [Qwik GitHub](https://github.com/QwikDev/qwik)
- [@QwikDev](https://twitter.com/QwikDev)
- [Vite](https://vitejs.dev/)

---

## Project Structure

This project is using Qwik with [QwikCity](https://qwik.dev/qwikcity/overview/). QwikCity is just an extra set of tools on top of Qwik to make it easier to build a full site, including directory-based routing, layouts, and more.

Inside your project, you'll see the following directory structure:

```
├── public/
│   └── ...
└── src/
    ├── components/
    │   └── ...
    └── routes/
        └── ...
```

- `src/routes`: Provides the directory-based routing, which can include a hierarchy of `layout.tsx` layout files, and an `index.tsx` file as the page. Additionally, `index.ts` files are endpoints. Please see the [routing docs](https://qwik.dev/qwikcity/routing/overview/) for more info.

- `src/components`: Recommended directory for components.

- `public`: Any static assets, like images, can be placed in the public directory. Please see the [Vite public directory](https://vitejs.dev/guide/assets.html#the-public-directory) for more info.

## Add Integrations and deployment

Use the `npm run qwik add` command to add additional integrations. Some examples of integrations includes: Cloudflare, Netlify or Express Server, and the [Static Site Generator (SSG)](https://qwik.dev/qwikcity/guides/static-site-generation/).

```shell
npm run qwik add # or `yarn qwik add`
```

## Development

Development mode uses [Vite's development server](https://vitejs.dev/). The `dev` command will server-side render (SSR) the output during development.

```shell
npm start # or `yarn start`
```

> Note: during dev mode, Vite may request a significant number of `.js` files. This does not represent a Qwik production build.

## Preview

The preview command will create a production build of the client modules, a production build of `src/entry.preview.tsx`, and run a local server. The preview server is only for convenience to preview a production build locally and should not be used as a production server.

```shell
npm run preview # or `yarn preview`
```

## Production

The production build will generate client and server modules by running both client and server build commands. The build command will use Typescript to run a type check on the source code.

```shell
npm run build # or `yarn build`
```

## Tests（perf-qwik-rust フロント）

- **単体**: `npm run test:unit`（Vitest、`tests/unit/`）。バックエンド不要。**[ENV-01]** の COOP/COEP は Qwik dev の HTML にヘッダが乗らないことがあるため、`vite.config.ts` の記述を静的検証するテストを含む。
- **E2E**: **CRUD・[SRV-01] を含むフル E2E は perf-qwik-rust バックエンド必須**（未起動・プロキシ不一致だと GraphQL が失敗する）。`frontend/.env` の **`BACKEND_URL` または `BACKEND_HOST`/`BACKEND_PORT`** を実際の `BIND_ADDR` と一致させる。初回のみ `npm run test:e2e:install`（Chromium 取得）。`npm run test:e2e` は `playwright.config` の `webServer` で **`npm run dev`** を立ち上げる（フロントのみ自動起動）。**5173 が既に使用中**のときはプロセスを止めるか `reuseExistingServer` を調整すること。不具合調査時はブラウザの Network で **`POST /api/graphql` のレスポンス本文**に `errors` が無いか確認すること（Vitest のみ緑でも E2E は未実行の可能性あり）。**認証済みシナリオ**は `tests/e2e/auth.setup.ts` が一度だけログインし `tests/e2e/.auth/dev.json` に `storageState` を書き出す（`.gitignore` 済み）。**`[RT-02]`（未認証で `/app` → ログインへ）**は `storageState` を使わない `chromium-unauth` プロジェクトのみで実行される。
- **UI モード**: `npm run test:e2e:ui`
- ログインは README 例どおり `dev@example.com` / `devpass`（本番シークレットをリポジトリに置かないこと）。

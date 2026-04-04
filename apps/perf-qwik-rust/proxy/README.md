# perf_pingora_proxy

[Pingora](https://github.com/cloudflare/pingora) の **HTTP/1.1** リバースプロキシ。`perf` バックエンド（Axum）の前段に置きます。

## 挙動

| 項目 | 内容 |
|------|------|
| **プロトコル** | クライアント ↔ プロキシ ↔ upstream はいずれも **HTTP/1.1**（平文）。TLS / HTTP/2 / HTTP/3 は扱いません。 |
| **パス** | **`/graphql`**（クエリ文字列付き可）→ upstream **`/api/graphql`**。`/api/*` は透過。 |
| **upstream** | 平文 `http://PERF_PROXY_UPSTREAM/`（既定 `127.0.0.1:8080`）。 |
| **ヘッダ** | `Host`、`X-Forwarded-Proto: http`、`X-Forwarded-For`（追記）。 |

## Pingora プロセス設定（YAML）

`config/pingora.yaml` を **`-c`** で渡します（`ServerConf`：スレッド数など）。

```bash
perf_pingora_proxy -c config/pingora.yaml
```

コンテナでは `/etc/pingora/pingora.yaml` に同内容をマウント／コピー済み（`Dockerfile` 参照）。

## 環境変数（ルーティング）

| 変数 | 既定 | 説明 |
|------|------|------|
| `PERF_PROXY_UPSTREAM` | `127.0.0.1:8080` | Axum の `host:port` |
| `PERF_PROXY_UPSTREAM_HOST` | upstream のホスト部分 | 上流への `Host` |
| `PERF_PROXY_HTTP_LISTEN` | `0.0.0.0:9080` | クライアント向けリスン |
| `RUST_LOG` | — | 例: `info` |

IPv6 の upstream では **`PERF_PROXY_UPSTREAM_HOST` を明示**してください。

## ローカル（バイナリ）

```bash
cd apps/perf-qwik-rust/proxy
cargo build --release
RUST_LOG=info cargo run --release -- -c config/pingora.yaml
```

## Docker（`infra/docker-compose.yml`）

```bash
cd apps/perf-qwik-rust/infra
docker compose build pingora
docker compose up -d pingora
```

既定では upstream は **`host.docker.internal:8080`**（ホストでバックエンドを起動している想定）。**Linux** では compose に `extra_hosts: host.docker.internal:host-gateway` を付与済みです。

バックエンドもコンテナ化する場合は、`PERF_PROXY_UPSTREAM` をサービス名（例 `backend:8080`）に変更し、同一 Docker ネットワークに載せてください。

## 設計メモ

`/mnt/storage/unleash/ai/workspace/perf-qwik-rust_p5_pingora_design_20260402.md`（HTTP/3 節は採用していません）。

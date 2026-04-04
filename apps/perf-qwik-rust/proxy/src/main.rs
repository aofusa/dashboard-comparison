//! perf-qwik-rust リバースプロキシ（**HTTP/1.1 のみ**）。
//! - 外向き `POST|GET /graphql`（クエリ付き可）→ upstream `/api/graphql`
//! - `/api/*` は透過
//! - `X-Forwarded-For` / `X-Forwarded-Proto: http`
//!
//! Pingora プロセス設定は **`-c pingora.yaml`**（`ServerConf`）。ルーティング値は環境変数（`proxy/README.md`）。

use async_trait::async_trait;
use http::Uri;
use log::info;
use pingora_core::server::configuration::Opt;
use pingora_core::server::Server;
use pingora_core::upstreams::peer::HttpPeer;
use pingora_core::Result;
use pingora_error::ErrorType::InvalidHTTPHeader;
use pingora_error::OrErr;
use pingora_http::RequestHeader;
use pingora_proxy::{ProxyHttp, Session};

fn rewrite_graphql_to_api(req: &mut RequestHeader) -> Result<()> {
    if req.uri.path() != "/graphql" {
        return Ok(());
    }
    let new_pq = req
        .uri
        .path_and_query()
        .map(|pq| {
            pq.query()
                .map(|q| format!("/api/graphql?{q}"))
                .unwrap_or_else(|| "/api/graphql".to_string())
        })
        .unwrap_or_else(|| "/api/graphql".to_string());
    let new_uri = Uri::builder()
        .path_and_query(new_pq.as_str())
        .build()
        .explain_err(InvalidHTTPHeader, |_| "rewrite /graphql")?;
    req.set_uri(new_uri);
    Ok(())
}

struct PerfProxy {
    upstream: String,
    host_header: String,
}

#[async_trait]
impl ProxyHttp for PerfProxy {
    type CTX = ();

    fn new_ctx(&self) -> Self::CTX {}

    async fn upstream_peer(
        &self,
        _session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        Ok(Box::new(HttpPeer::new(
            &self.upstream,
            false,
            self.host_header.clone(),
        )))
    }

    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        _ctx: &mut Self::CTX,
    ) -> Result<()> {
        rewrite_graphql_to_api(upstream_request)?;
        upstream_request.insert_header("Host", self.host_header.as_str())?;
        upstream_request.insert_header("X-Forwarded-Proto", "http")?;

        if let Some(addr) = session.client_addr() {
            let ip = addr.to_string();
            let merged = match upstream_request.headers.get("X-Forwarded-For") {
                Some(v) => {
                    let prev = v.to_str().unwrap_or("");
                    if prev.is_empty() {
                        ip
                    } else {
                        format!("{prev}, {ip}")
                    }
                }
                None => ip,
            };
            upstream_request.insert_header("X-Forwarded-For", merged.as_str())?;
        }

        Ok(())
    }
}

fn load_proxy_env() -> PerfProxy {
    let upstream =
        std::env::var("PERF_PROXY_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let host_header = std::env::var("PERF_PROXY_UPSTREAM_HOST").unwrap_or_else(|_| {
        upstream
            .rsplit_once(':')
            .map(|(h, _)| h.to_string())
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string())
    });

    PerfProxy {
        upstream,
        host_header,
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let opt = Opt::parse_args();
    let mut server = Server::new(Some(opt)).expect("server init");
    server.bootstrap();

    let app = load_proxy_env();
    info!(
        "perf_pingora_proxy: HTTP/1.1 listen (env PERF_PROXY_HTTP_LISTEN), upstream={} Host={}",
        app.upstream, app.host_header
    );

    let mut proxy = pingora_proxy::http_proxy_service(&server.configuration, app);

    let http_listen =
        std::env::var("PERF_PROXY_HTTP_LISTEN").unwrap_or_else(|_| "0.0.0.0:9080".to_string());
    proxy.add_tcp(&http_listen);

    server.add_service(proxy);
    server.run_forever();
}

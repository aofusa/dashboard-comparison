mod arrow_export;
mod auth_flow;
mod cached_content;
mod config;
mod content_repo;
mod graphql_app;
mod meta_repo;
mod session_moka_store;

use std::net::SocketAddr;
use std::sync::Arc;

use async_graphql::dataloader::DataLoader;
use async_graphql::Request as GqlRequest;
use async_graphql_axum::GraphQLResponse;
use axum::http::header::{self, AUTHORIZATION, ACCEPT};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{body::Body, Json, Router};
use content_repo::{ContentRepository, DuckDbContentRepository};
use graphql_app::{build_schema, AppSchema, BearerToken, EmailLoader, UserId};
use meta_repo::{MetaRepository, SqliteMetaRepository, UserRecord};
use serde_json::json;
use time::Duration as TimeDuration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tower_sessions::{Expiry, Session, SessionManagerLayer};

use crate::session_moka_store::MokaSessionStore;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::cached_content::MokaCachedContent;
use crate::config::Config;

/// `Accept` に含めれば Arrow バイナリ応答（`operationName: ItemsArrowBinary` と併用）。
pub const MIME_ARROW_VND: &str = "application/vnd.apache.arrow.stream; codecs=zstd";
/// REST 時代からの互換 MIME。
pub const MIME_ARROW_LEGACY: &str = "application/x-arrow-ipc+zstd";

#[derive(Clone)]
pub struct AppState {
    pub meta: Arc<SqliteMetaRepository>,
    pub content: Arc<dyn ContentRepository>,
    pub content_path: String,
    pub jwt_secret: String,
    pub jwt_access_secs: u64,
    pub jwt_refresh_days: u64,
    /// バイナリ Arrow 応答の最大バイト数（超過時 413）。0 = 無制限扱い。
    pub arrow_binary_max_bytes: usize,
    pub schema: AppSchema,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let cfg = Config::from_env()?;

    let meta = Arc::new(SqliteMetaRepository::open(
        &cfg.meta_db_path,
        cfg.meta_pool_size.max(1),
    )?);
    meta.migrate().await?;

    let duck = Arc::new(DuckDbContentRepository::new(cfg.content_db_path.clone())?);
    seed_if_empty(&meta, duck.as_ref()).await?;
    let inner: Arc<dyn ContentRepository> = duck.clone();
    let moka = Arc::new(MokaCachedContent::new(inner, cfg.moka_max_bytes));
    let content: Arc<dyn ContentRepository> = moka.clone();

    let schema = build_schema();

    let state = Arc::new(AppState {
        meta: meta.clone(),
        content,
        content_path: cfg.content_db_path.clone(),
        jwt_secret: cfg.jwt_secret.clone(),
        jwt_access_secs: cfg.jwt_access_exp_minutes.saturating_mul(60).max(60),
        jwt_refresh_days: cfg.jwt_refresh_exp_days,
        arrow_binary_max_bytes: cfg.arrow_binary_max_bytes,
        schema,
    });

    let session_store = MokaSessionStore::new(cfg.session_moka_capacity);
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(TimeDuration::hours(24 * 7)));

    let bind: SocketAddr = cfg.bind.parse()?;
    let api = Router::new()
        .route("/api/graphql", post(graphql_post_handler))
        .with_state(state.clone());

    let app = Router::new()
        .merge(api)
        .layer(session_layer)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http());

    tracing::info!(
        "lowspec_backend (graphql-only) http://{bind} meta={} content={}",
        cfg.meta_db_path,
        cfg.content_db_path
    );
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn seed_if_empty(meta: &SqliteMetaRepository, content_db: &DuckDbContentRepository) -> anyhow::Result<()> {
    if meta.find_user_by_email("dev@example.com").await?.is_some() {
        return Ok(());
    }
    let id = Uuid::new_v4().to_string();
    let hash = auth_flow::hash_password("devpass")?;
    meta.insert_user(&UserRecord {
        id: id.clone(),
        email: "dev@example.com".into(),
        password_hash: hash,
        name: "Dev User".into(),
    })
    .await?;
    for i in 0..80 {
        content_db
            .create_item(&id, &format!("Item {i}"))
            .await?;
    }
    tracing::info!("seeded dev@example.com / devpass");
    Ok(())
}

async fn graphql_post_handler(
    State(state): State<Arc<AppState>>,
    session: Session,
    headers: HeaderMap,
    body: String,
) -> Response {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "errors": [{ "message": "invalid json body" }] })),
        )
            .into_response();
    };
    let op = v
        .get("operationName")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let accept = headers
        .get(ACCEPT)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let wants_arrow_binary = op == "ItemsArrowBinary"
        && (accept.contains(MIME_ARROW_VND)
            || accept.contains(MIME_ARROW_LEGACY)
            || accept == "*/*");

    if wants_arrow_binary {
        return match arrow_binary_response(&state, &headers, &session).await {
            Ok(r) => r,
            Err(status) => (
                status,
                Json(json!({ "errors": [{ "message": "unauthorized or arrow error" }] })),
            )
                .into_response(),
        };
    }

    let Some(qs) = v.get("query").and_then(|x| x.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "errors": [{ "message": "missing query" }] })),
        )
            .into_response();
    };
    let mut req = GqlRequest::new(qs);
    if let Some(on) = v.get("operationName").and_then(|x| x.as_str()) {
        req = req.operation_name(on);
    }
    if let Some(vars) = v.get("variables") {
        if !vars.is_null() {
            let gql_vars = async_graphql::Variables::from_json(vars.clone());
            req = req.variables(gql_vars);
        }
    }

    graphql_json_response(state, session, headers, req).await
}

async fn arrow_binary_response(
    state: &AppState,
    headers: &HeaderMap,
    session: &Session,
) -> Result<Response, StatusCode> {
    let uid = resolve_user_id(state, headers, session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let bytes = crate::arrow_export::items_arrow_ipc_zstd(&state.content_path, &uid)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if state.arrow_binary_max_bytes > 0 && bytes.len() > state.arrow_binary_max_bytes {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let ct = if headers
        .get(ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|a| a.contains(MIME_ARROW_VND))
    {
        MIME_ARROW_VND
    } else {
        MIME_ARROW_LEGACY
    };
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(axum::http::header::VARY, "Accept")
        .body(Body::from(bytes))
        .unwrap())
}

async fn graphql_json_response(
    state: Arc<AppState>,
    session: Session,
    headers: HeaderMap,
    req: GqlRequest,
) -> Response {
    let loader = DataLoader::new(
        EmailLoader {
            meta: state.meta.clone(),
        },
        tokio::spawn,
    );
    let bearer_str = bearer(&headers).map(|s| s.to_string());
    let mut gql = req
        .data(state.clone())
        .data(session.clone())
        .data(state.content.clone())
        .data(loader)
        .data(state.meta.clone())
        .data(BearerToken(bearer_str.clone()));
    let mut uid_opt = None;
    if let Some(ref tok) = bearer_str {
        uid_opt = crate::auth_flow::user_id_from_jwt(&state.jwt_secret, tok).ok();
    }
    if uid_opt.is_none() {
        if let Ok(Some(u)) = session.get::<String>("user_id").await {
            uid_opt = Some(u);
        }
    }
    if let Some(uid) = uid_opt {
        gql = gql.data(UserId(uid));
    }
    GraphQLResponse::from(state.schema.execute(gql).await).into_response()
}

use axum::extract::State;

async fn resolve_user_id(
    state: &AppState,
    headers: &HeaderMap,
    session: &Session,
) -> Result<String, ()> {
    if let Some(tok) = bearer(headers) {
        return crate::auth_flow::user_id_from_jwt(&state.jwt_secret, tok).map_err(|_| ());
    }
    if let Ok(Some(uid)) = session.get::<String>("user_id").await {
        return Ok(uid);
    }
    Err(())
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    let v = headers.get(AUTHORIZATION)?.to_str().ok()?;
    v.strip_prefix("Bearer ").map(str::trim)
}

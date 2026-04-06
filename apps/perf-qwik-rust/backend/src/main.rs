mod arrow_export;
mod auth;
mod auth_flow;
mod config;
mod content_repository;
mod content_write_through;
mod dynamo;
mod graphql;
mod refresh_repo;
mod session_dragonfly_store;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use async_graphql::dataloader::DataLoader;
use async_graphql::Request as GqlRequest;
use async_graphql_axum::GraphQLResponse;
use auth::hash_password;
use axum::body::Body;
use axum::extract::State;
use axum::http::header::{self, AUTHORIZATION, ACCEPT};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_dynamodb::config::BehaviorVersion;
use aws_sdk_dynamodb::config::Builder as DdbConfigBuilder;
use content_repository::{ContentRepository, DynamoContentRepository};
use content_write_through::WriteThroughContentRepository;
use graphql::{
    build_schema, AppSchema, AppServices, BearerToken, EmailLoader, GraphqlExtras, UserId,
};
use redis::aio::ConnectionManager;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use time::Duration as TimeDuration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tower_sessions::{Expiry, Session, SessionManagerLayer};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::config::Config;

/// `Accept` に含めれば Arrow バイナリ応答（`operationName: ItemsArrowBinary` と併用）。
pub const MIME_ARROW_VND: &str = "application/vnd.apache.arrow.stream; codecs=zstd";
pub const MIME_ARROW_LEGACY: &str = "application/x-arrow-ipc+zstd";

#[derive(Clone)]
struct AppState {
    pool: MySqlPool,
    services: Arc<AppServices>,
    jwt_secret: String,
    jwt_access_secs: u64,
    jwt_refresh_days: u64,
    arrow_binary_max_bytes: usize,
    schema: AppSchema,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let cfg = Config::from_env()?;

    let pool = MySqlPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.mysql_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let creds = Credentials::new(
        cfg.aws_access_key_id.clone(),
        cfg.aws_secret_access_key.clone(),
        None,
        None,
        "perf-backend",
    );
    let mut b = DdbConfigBuilder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new(cfg.aws_region.clone()))
        .credentials_provider(creds);
    if let Some(ref ep) = cfg.dynamodb_endpoint {
        b = b.endpoint_url(ep);
    }
    let ddb = aws_sdk_dynamodb::Client::from_conf(b.build());
    dynamo::ensure_table(&ddb, &cfg.dynamodb_table).await?;

    seed_if_empty(&pool, &ddb, &cfg.dynamodb_table).await?;

    let ddb_repo = Arc::new(DynamoContentRepository {
        client: ddb.clone(),
        table: cfg.dynamodb_table.clone(),
    });
    let content: Arc<dyn ContentRepository> = if cfg.cache_list_enabled {
        let client = redis::Client::open(cfg.cache_redis_url.as_str()).with_context(|| {
            format!(
                "一覧キャッシュ: Redis URL が無効です (`PERF_CACHE_REDIS_URL` / `SESSION_REDIS_URL`={})",
                cfg.cache_redis_url
            )
        })?;
        let cm = ConnectionManager::new(client)
            .await
            .context("一覧キャッシュ: Dragonfly/Redis ConnectionManager の確立に失敗しました")?;
        Arc::new(WriteThroughContentRepository::new(
            Arc::clone(&ddb_repo),
            cm,
            cfg.cache_key_prefix.clone(),
            cfg.cache_list_ttl_secs,
        ))
    } else {
        ddb_repo
    };
    let services = Arc::new(AppServices { content });
    let schema = build_schema(&cfg);

    let jwt_access_secs = cfg.jwt_access_exp_minutes.saturating_mul(60).max(60);
    let jwt_refresh_days = cfg.jwt_refresh_exp_days;

    let state = Arc::new(AppState {
        pool: pool.clone(),
        services,
        jwt_secret: cfg.jwt_secret.clone(),
        jwt_access_secs,
        jwt_refresh_days,
        arrow_binary_max_bytes: cfg.arrow_binary_max_bytes,
        schema,
    });

    let session_store = session_dragonfly_store::DragonflySessionStore::connect(
        &cfg.session_redis_url,
        cfg.session_redis_key_prefix.clone(),
    )
    .await
    .with_context(|| {
        format!(
            "tower-sessions: Dragonfly/Redis に接続できません (`SESSION_REDIS_URL`={})",
            cfg.session_redis_url
        )
    })?;
    tracing::info!(
        session_backend = "dragonfly/redis",
        url = %cfg.session_redis_url,
        key_prefix = %cfg.session_redis_key_prefix,
        "tower-sessions store ready"
    );
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
        "perf_backend (graphql-only) listening on http://{bind} mysql={} dynamodb_table={}",
        cfg.mysql_url.split('@').next().unwrap_or("mysql"),
        cfg.dynamodb_table
    );
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn seed_if_empty(
    pool: &MySqlPool,
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
) -> anyhow::Result<()> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    if n > 0 {
        return Ok(());
    }
    let id = Uuid::new_v4().to_string();
    let hash = hash_password("devpass")?;
    sqlx::query("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind("dev@example.com")
        .bind(&hash)
        .bind("Dev User")
        .execute(pool)
        .await?;
    for i in 0..12 {
        let iid = Uuid::new_v4().to_string();
        dynamo::put_item(ddb, table, &iid, &id, &format!("Item {i}")).await?;
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
    let bytes = crate::arrow_export::items_arrow_ipc_zstd_for_user(
        state.services.content.clone(),
        uid,
    )
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
            pool: state.pool.clone(),
        },
        tokio::spawn,
    );
    let extras = GraphqlExtras {
        pool: state.pool.clone(),
        jwt_secret: state.jwt_secret.clone(),
        jwt_access_secs: state.jwt_access_secs,
        jwt_refresh_days: state.jwt_refresh_days,
    };
    let bearer_str = bearer(&headers).map(|s| s.to_string());
    let mut gql = req
        .data(state.services.clone())
        .data(extras)
        .data(session.clone())
        .data(loader)
        .data(BearerToken(bearer_str.clone()));
    let mut uid_opt = None;
    if let Some(ref tok) = bearer_str {
        uid_opt = auth_flow::user_id_from_jwt(&state.jwt_secret, tok).ok();
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

async fn resolve_user_id(
    state: &AppState,
    headers: &HeaderMap,
    session: &Session,
) -> Result<String, ()> {
    if let Some(tok) = bearer(headers) {
        return auth_flow::user_id_from_jwt(&state.jwt_secret, tok).map_err(|_| ());
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

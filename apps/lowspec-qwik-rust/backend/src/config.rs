#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub jwt_secret: String,
    pub meta_db_path: String,
    pub content_db_path: String,
    pub moka_max_bytes: u64,
    pub meta_pool_size: usize,
    /// Access JWT の有効期限（分）。仕様は 15 分。
    pub jwt_access_exp_minutes: u64,
    /// Refresh トークン有効期限（日）。
    pub jwt_refresh_exp_days: u64,
    /// tower-sessions（MokaStore）の最大セッション数。
    pub session_moka_capacity: u64,
    /// `ItemsArrowBinary` バイナリ応答の最大バイト数（0 = 上限なし）。
    pub arrow_binary_max_bytes: usize,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let _ = dotenvy::dotenv();
        Ok(Self {
            bind: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into()),
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-insecure-change-me".into()),
            meta_db_path: std::env::var("META_DB_PATH").unwrap_or_else(|_| "meta.db".into()),
            content_db_path: std::env::var("CONTENT_DB_PATH").unwrap_or_else(|_| "content.duckdb".into()),
            moka_max_bytes: std::env::var("MOKA_MAX_BYTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(200 * 1024 * 1024),
            meta_pool_size: std::env::var("META_POOL_SIZE")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(4),
            jwt_access_exp_minutes: std::env::var("JWT_ACCESS_EXP_MINUTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15)
                .max(1),
            jwt_refresh_exp_days: std::env::var("JWT_REFRESH_EXP_DAYS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(7)
                .max(1),
            session_moka_capacity: std::env::var("SESSION_MOKA_MAX")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(4096)
                .max(64),
            arrow_binary_max_bytes: std::env::var("ARROW_BINARY_MAX_BYTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
        })
    }
}

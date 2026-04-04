#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub jwt_secret: String,
    pub mysql_url: String,
    pub dynamodb_endpoint: Option<String>,
    pub dynamodb_table: String,
    pub aws_region: String,
    pub aws_access_key_id: String,
    pub aws_secret_access_key: String,
    pub graphql_max_depth: usize,
    pub graphql_max_complexity: usize,
    pub graphql_apq_cache_size: usize,
    /// Arrow バイナリ応答（`ItemsArrowBinary`）の最大バイト。0 = 実質無制限。
    pub arrow_binary_max_bytes: usize,
    /// Access JWT の有効期限（分）。仕様は 15 分。
    pub jwt_access_exp_minutes: u64,
    /// Refresh トークン有効期限（日）。
    pub jwt_refresh_exp_days: u64,
    /// tower-sessions の **Dragonfly / Redis** URL（例: `redis://127.0.0.1:6379`）。
    pub session_redis_url: String,
    /// セッションキー接頭辞（Dragonfly 内の他キーと衝突させない）。
    pub session_redis_key_prefix: String,
    /// **`items` 一覧ページ**の Dragonfly/Redis read-through（P4b）。`false` で Dynamo のみ。
    pub cache_list_enabled: bool,
    /// 一覧キャッシュ用 Redis URL。空なら `SESSION_REDIS_URL`（なければ `REDIS_URL`）と同じ。
    pub cache_redis_url: String,
    /// 一覧キャッシュ・リスト世代キーの接頭辞（セッション `SESSION_REDIS_KEY_PREFIX` と分離）。
    pub cache_key_prefix: String,
    /// ページキャッシュの TTL（秒）。
    pub cache_list_ttl_secs: u64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let _ = dotenvy::dotenv();
        let session_redis_url = std::env::var("SESSION_REDIS_URL")
            .or_else(|_| std::env::var("REDIS_URL"))
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let cache_redis_url = std::env::var("PERF_CACHE_REDIS_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| session_redis_url.clone());
        Ok(Self {
            bind: std::env::var("BIND_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:8080".into()),
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-insecure-change-me".into()),
            mysql_url: std::env::var("MYSQL_URL").unwrap_or_else(|_| {
                "mysql://root:perfroot@127.0.0.1:3306/perf_meta".into()
            }),
            dynamodb_endpoint: std::env::var("DYNAMODB_ENDPOINT")
                .ok()
                .filter(|s| !s.is_empty()),
            dynamodb_table: std::env::var("DYNAMODB_TABLE")
                .unwrap_or_else(|_| "perf_items".into()),
            aws_region: std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".into()),
            aws_access_key_id: std::env::var("AWS_ACCESS_KEY_ID")
                .unwrap_or_else(|_| "alternator".into()),
            aws_secret_access_key: std::env::var("AWS_SECRET_ACCESS_KEY")
                .unwrap_or_else(|_| "alternator".into()),
            graphql_max_depth: std::env::var("GRAPHQL_MAX_DEPTH")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(16),
            graphql_max_complexity: std::env::var("GRAPHQL_MAX_COMPLEXITY")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(256),
            graphql_apq_cache_size: std::env::var("GRAPHQL_APQ_CACHE_SIZE")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(512)
                .max(1),
            arrow_binary_max_bytes: std::env::var("ARROW_BINARY_MAX_BYTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
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
            session_redis_url,
            session_redis_key_prefix: std::env::var("SESSION_REDIS_KEY_PREFIX")
                .unwrap_or_else(|_| "perf:sess:".into()),
            cache_list_enabled: env_flag("PERF_CACHE_LIST_ENABLED", true),
            cache_redis_url,
            cache_key_prefix: std::env::var("PERF_CACHE_KEY_PREFIX")
                .unwrap_or_else(|_| "perf:wt:".into()),
            cache_list_ttl_secs: std::env::var("PERF_CACHE_LIST_TTL_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(300)
                .max(10),
        })
    }
}

/// `1` / `true` / `yes` / `on` → true、`0` / `false` / `no` / `off` → false、未設定は `default`。
fn env_flag(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(s) => {
            let s = s.trim().to_lowercase();
            match s.as_str() {
                "" => default,
                "0" | "false" | "no" | "off" => false,
                "1" | "true" | "yes" | "on" => true,
                _ => default,
            }
        }
        Err(_) => default,
    }
}

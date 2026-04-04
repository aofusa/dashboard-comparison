//! ログイン時の Access + Refresh 発行と tower-sessions への `user_id` 格納（REST / GraphQL 共有）。

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;
use time::Duration as TimeDuration;
use tower_sessions::Session;
use uuid::Uuid;

use crate::auth::verify_password;
use crate::refresh_repo;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

#[derive(Debug)]
pub enum LoginError {
    Unauthorized,
    Internal,
}

#[derive(Clone)]
pub struct LoginTokens {
    pub token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

pub async fn login_issue_tokens(
    session: &Session,
    pool: &MySqlPool,
    jwt_secret: &str,
    jwt_access_secs: u64,
    jwt_refresh_days: u64,
    email: &str,
    password: &str,
) -> Result<LoginTokens, LoginError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, password_hash FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|_| LoginError::Internal)?;
    let (user_id, hash) = row.ok_or(LoginError::Unauthorized)?;
    if !verify_password(password, &hash) {
        return Err(LoginError::Unauthorized);
    }
    refresh_repo::delete_refresh_tokens_for_user(pool, &user_id)
        .await
        .map_err(|_| LoginError::Internal)?;

    let token = encode_access_token(&user_id, jwt_secret, jwt_access_secs)?;

    let refresh_raw = format!(
        "{}{}",
        Uuid::new_v4().as_simple(),
        Uuid::new_v4().as_simple()
    );
    let refresh_hash = sha256_hex(&refresh_raw);
    let row_id = Uuid::new_v4().to_string();
    let exp_ts = (time::OffsetDateTime::now_utc()
        + TimeDuration::days(jwt_refresh_days.max(1) as i64))
        .unix_timestamp();
    refresh_repo::insert_refresh_token(pool, &row_id, &user_id, &refresh_hash, exp_ts)
        .await
        .map_err(|_| LoginError::Internal)?;

    session
        .insert("user_id", user_id)
        .await
        .map_err(|_| LoginError::Internal)?;

    Ok(LoginTokens {
        token,
        refresh_token: refresh_raw,
        expires_in: jwt_access_secs,
    })
}

/// Refresh 回転後の新しい Access JWT。
pub fn encode_access_token(
    user_id: &str,
    jwt_secret: &str,
    jwt_access_secs: u64,
) -> Result<String, LoginError> {
    let exp = SystemTime::now()
        .checked_add(Duration::from_secs(jwt_access_secs.max(60)))
        .ok_or(LoginError::Internal)?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| LoginError::Internal)?
        .as_secs() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|_| LoginError::Internal)
}

/// Refresh ローテーション（GraphQL `authRefresh`）。
pub async fn refresh_access_token(
    pool: &MySqlPool,
    jwt_secret: &str,
    jwt_access_secs: u64,
    jwt_refresh_days: u64,
    refresh_token: &str,
) -> Result<LoginTokens, LoginError> {
    let hash = sha256_hex(refresh_token);
    let pair = refresh_repo::find_user_by_refresh_hash(pool, &hash)
        .await
        .map_err(|_| LoginError::Internal)?;
    let (row_id, user_id) = pair.ok_or(LoginError::Unauthorized)?;
    refresh_repo::delete_refresh_token(pool, &row_id)
        .await
        .map_err(|_| LoginError::Internal)?;

    let token = encode_access_token(&user_id, jwt_secret, jwt_access_secs)?;

    let refresh_raw = format!(
        "{}{}",
        Uuid::new_v4().as_simple(),
        Uuid::new_v4().as_simple()
    );
    let refresh_hash = sha256_hex(&refresh_raw);
    let new_row = Uuid::new_v4().to_string();
    let exp_ts = (time::OffsetDateTime::now_utc()
        + TimeDuration::days(jwt_refresh_days.max(1) as i64))
        .unix_timestamp();
    refresh_repo::insert_refresh_token(pool, &new_row, &user_id, &refresh_hash, exp_ts)
        .await
        .map_err(|_| LoginError::Internal)?;

    Ok(LoginTokens {
        token,
        refresh_token: refresh_raw,
        expires_in: jwt_access_secs,
    })
}

/// セッション無効化。`user_id` がセッションにあれば当該ユーザーの Refresh を全削除。
pub async fn logout_user(session: &Session, pool: &MySqlPool) -> Result<(), LoginError> {
    if let Ok(Some(uid)) = session.get::<String>("user_id").await {
        let _ = refresh_repo::delete_refresh_tokens_for_user(pool, &uid).await;
    }
    session.remove::<String>("user_id").await.ok();
    session
        .flush()
        .await
        .map_err(|_| LoginError::Internal)?;
    Ok(())
}

pub fn user_id_from_jwt(secret: &str, token: &str) -> Result<String, LoginError> {
    let t = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| LoginError::Unauthorized)?;
    Ok(t.claims.sub)
}

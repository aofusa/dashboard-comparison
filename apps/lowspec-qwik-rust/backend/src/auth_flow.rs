//! ログイン時のトークン発行（REST / GraphQL で共有）

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::password_hash::{PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::Duration as TimeDuration;
use tower_sessions::Session;
use uuid::Uuid;

use crate::meta_repo::MetaRepository;

#[derive(Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

pub fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

pub fn hash_password(pw: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    let argon2 = Argon2::default();
    Ok(argon2.hash_password(pw.as_bytes(), &salt)?.to_string())
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(pw.as_bytes(), &parsed)
        .is_ok()
}

#[derive(Debug)]
pub enum LoginError {
    Unauthorized,
    Internal,
}

#[derive(Debug, Clone)]
pub struct LoginTokens {
    pub token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

/// Access / Refresh を発行し、セッションに `user_id` を格納する（REST login / GraphQL authLogin 共通）。
pub async fn login_issue_tokens<M: MetaRepository + Send + Sync>(
    session: &Session,
    meta: &M,
    jwt_secret: &str,
    jwt_access_secs: u64,
    jwt_refresh_days: u64,
    email: &str,
    password: &str,
) -> Result<LoginTokens, LoginError> {
    let row = meta
        .find_user_by_email(email)
        .await
        .map_err(|_| LoginError::Internal)?;
    let u = row.ok_or(LoginError::Unauthorized)?;
    if !verify_password(password, &u.password_hash) {
        return Err(LoginError::Unauthorized);
    }
    let _ = meta.delete_refresh_tokens_for_user(&u.id).await;

    let exp = SystemTime::now()
        .checked_add(Duration::from_secs(jwt_access_secs))
        .ok_or(LoginError::Internal)?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| LoginError::Internal)?
        .as_secs() as usize;
    let claims = Claims {
        sub: u.id.clone(),
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|_| LoginError::Internal)?;

    let refresh_raw = format!(
        "{}{}",
        Uuid::new_v4().as_simple(),
        Uuid::new_v4().as_simple()
    );
    let refresh_hash = sha256_hex(&refresh_raw);
    let row_id = Uuid::new_v4().to_string();
    let exp_ts = (time::OffsetDateTime::now_utc() + TimeDuration::days(jwt_refresh_days as i64))
        .unix_timestamp();
    meta.insert_refresh_token(&row_id, &u.id, &refresh_hash, exp_ts)
        .await
        .map_err(|_| LoginError::Internal)?;

    session
        .insert("user_id", u.id.clone())
        .await
        .map_err(|_| LoginError::Internal)?;

    Ok(LoginTokens {
        token,
        refresh_token: refresh_raw,
        expires_in: jwt_access_secs,
    })
}

/// Refresh ローテーション（REST 廃止後は GraphQL `authRefresh` から呼ぶ）。
pub async fn refresh_access_token<M: MetaRepository + Send + Sync>(
    meta: &M,
    jwt_secret: &str,
    jwt_access_secs: u64,
    jwt_refresh_days: u64,
    refresh_token: &str,
) -> Result<LoginTokens, LoginError> {
    let hash = sha256_hex(refresh_token);
    let pair = meta
        .find_user_by_refresh_hash(&hash)
        .await
        .map_err(|_| LoginError::Internal)?;
    let (row_id, user_id) = pair.ok_or(LoginError::Unauthorized)?;
    meta.delete_refresh_token(&row_id)
        .await
        .map_err(|_| LoginError::Internal)?;

    let exp = SystemTime::now()
        .checked_add(Duration::from_secs(jwt_access_secs))
        .ok_or(LoginError::Internal)?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| LoginError::Internal)?
        .as_secs() as usize;
    let claims = Claims {
        sub: user_id.clone(),
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|_| LoginError::Internal)?;

    let refresh_raw = format!(
        "{}{}",
        Uuid::new_v4().as_simple(),
        Uuid::new_v4().as_simple()
    );
    let refresh_hash = sha256_hex(&refresh_raw);
    let new_row = Uuid::new_v4().to_string();
    let exp_ts = (time::OffsetDateTime::now_utc() + TimeDuration::days(jwt_refresh_days as i64))
        .unix_timestamp();
    meta.insert_refresh_token(&new_row, &user_id, &refresh_hash, exp_ts)
        .await
        .map_err(|_| LoginError::Internal)?;

    Ok(LoginTokens {
        token,
        refresh_token: refresh_raw,
        expires_in: jwt_access_secs,
    })
}

/// セッション無効化 + 当該ユーザーの Refresh 全削除。
pub async fn logout_user<M: MetaRepository + Send + Sync>(
    session: &Session,
    meta: &M,
) -> Result<(), LoginError> {
    if let Ok(Some(uid)) = session.get::<String>("user_id").await {
        let _ = meta.delete_refresh_tokens_for_user(&uid).await;
    }
    session.remove::<String>("user_id").await.ok();
    session
        .flush()
        .await
        .map_err(|_| LoginError::Internal)?;
    Ok(())
}

/// Bearer JWT から `sub` を取り出す（GraphQL `authLogout` で Access 必須にする場合）。
pub fn user_id_from_jwt(secret: &str, token: &str) -> Result<String, LoginError> {
    let t = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| LoginError::Unauthorized)?;
    Ok(t.claims.sub)
}


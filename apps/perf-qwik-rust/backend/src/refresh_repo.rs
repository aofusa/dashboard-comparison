//! Refresh トークン（ハッシュのみ MySQL 保存）。lowspec の SQLite 版と同方針。

use sqlx::MySqlPool;

pub async fn delete_refresh_tokens_for_user(
    pool: &MySqlPool,
    user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ?")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn insert_refresh_token(
    pool: &MySqlPool,
    id: &str,
    user_id: &str,
    token_hash: &str,
    expires_at: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// 有効期限内なら `(row_id, user_id)`。
pub async fn find_user_by_refresh_hash(
    pool: &MySqlPool,
    hash: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    let now = chrono::Utc::now().timestamp();
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT id, user_id FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(hash)
    .bind(now)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn delete_refresh_token(pool: &MySqlPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM refresh_tokens WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

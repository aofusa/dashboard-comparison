//! MetaRepository（SQLite + WAL + synchronous=NORMAL）— 仕様 v1.5.1  
//! **deadpool-sqlite** プール + `interact`（仕様の deadpool 表記）。

use std::collections::HashMap;

use anyhow::Context;
use async_trait::async_trait;
use deadpool::managed::PoolConfig;
use deadpool_sqlite::rusqlite::OptionalExtension;
use deadpool_sqlite::{Config, Pool, Runtime};

#[derive(Clone)]
pub struct UserRecord {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub name: String,
}

#[async_trait]
pub trait MetaRepository: Send + Sync {
    async fn find_user_by_email(&self, email: &str) -> anyhow::Result<Option<UserRecord>>;
    async fn get_emails_by_ids(&self, ids: &[String]) -> anyhow::Result<HashMap<String, String>>;
    async fn insert_user(&self, u: &UserRecord) -> anyhow::Result<()>;
    /// リフレッシュトークンを保存（`token_hash` は hex など固定長文字列）
    async fn insert_refresh_token(
        &self,
        id: &str,
        user_id: &str,
        token_hash: &str,
        expires_at_unix: i64,
    ) -> anyhow::Result<()>;
    /// ハッシュ一致かつ未期限の行から user_id を返す
    async fn find_user_by_refresh_hash(&self, token_hash: &str) -> anyhow::Result<Option<(String, String)>>;
    async fn delete_refresh_token(&self, id: &str) -> anyhow::Result<()>;
    async fn delete_refresh_tokens_for_user(&self, user_id: &str) -> anyhow::Result<()>;
}

#[derive(Clone)]
pub struct SqliteMetaRepository {
    pool: Pool,
}

impl SqliteMetaRepository {
    pub fn open(path: impl Into<std::path::PathBuf>, max_size: usize) -> anyhow::Result<Self> {
        let mut cfg = Config::new(path.into());
        cfg.pool = Some(PoolConfig {
            max_size,
            ..Default::default()
        });
        let pool = cfg.create_pool(Runtime::Tokio1)?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(|c| {
            c.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=NORMAL;
                 CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    name TEXT NOT NULL
                );
                 CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id TEXT PRIMARY KEY NOT NULL,
                    user_id TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at INTEGER NOT NULL
                );
                 CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);",
            )?;
            Ok::<(), deadpool_sqlite::rusqlite::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("meta migrate interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("meta migrate sqlite: {e}"))?;
        Ok(())
    }
}

#[async_trait]
impl MetaRepository for SqliteMetaRepository {
    async fn find_user_by_email(&self, email: &str) -> anyhow::Result<Option<UserRecord>> {
        let email = email.to_string();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            let mut stmt = c.prepare("SELECT id, email, password_hash, name FROM users WHERE email = ?")?;
            let row = stmt
                .query_row([&email], |r| {
                    Ok(UserRecord {
                        id: r.get(0)?,
                        email: r.get(1)?,
                        password_hash: r.get(2)?,
                        name: r.get(3)?,
                    })
                })
                .optional()?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(row)
        })
        .await
        .map_err(|e| anyhow::anyhow!("find_user interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn get_emails_by_ids(&self, ids: &[String]) -> anyhow::Result<HashMap<String, String>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let ids = ids.to_vec();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            use deadpool_sqlite::rusqlite::params_from_iter;
            let ph = vec!["?"; ids.len()].join(",");
            let sql = format!("SELECT id, email FROM users WHERE id IN ({ph})");
            let mut stmt = c.prepare(&sql)?;
            let mut out = HashMap::new();
            let rows = stmt.query_map(params_from_iter(ids.iter()), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, email) = row?;
                out.insert(id, email);
            }
            Ok::<_, deadpool_sqlite::rusqlite::Error>(out)
        })
        .await
        .map_err(|e| anyhow::anyhow!("get_emails interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn insert_user(&self, u: &UserRecord) -> anyhow::Result<()> {
        let u = u.clone();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            c.execute(
                "INSERT INTO users (id, email, password_hash, name) VALUES (?1, ?2, ?3, ?4)",
                deadpool_sqlite::rusqlite::params![u.id, u.email, u.password_hash, u.name],
            )?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("insert_user interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn insert_refresh_token(
        &self,
        id: &str,
        user_id: &str,
        token_hash: &str,
        expires_at_unix: i64,
    ) -> anyhow::Result<()> {
        let id = id.to_string();
        let user_id = user_id.to_string();
        let token_hash = token_hash.to_string();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            c.execute(
                "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)",
                deadpool_sqlite::rusqlite::params![id, user_id, token_hash, expires_at_unix],
            )?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("insert_refresh interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn find_user_by_refresh_hash(
        &self,
        token_hash: &str,
    ) -> anyhow::Result<Option<(String, String)>> {
        let token_hash = token_hash.to_string();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            let mut stmt = c.prepare(
                "SELECT id, user_id FROM refresh_tokens WHERE token_hash = ?1 AND expires_at > ?2",
            )?;
            let row = stmt
                .query_row(deadpool_sqlite::rusqlite::params![token_hash, now], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .optional()?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(row)
        })
        .await
        .map_err(|e| anyhow::anyhow!("find_refresh interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn delete_refresh_token(&self, id: &str) -> anyhow::Result<()> {
        let id = id.to_string();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            c.execute("DELETE FROM refresh_tokens WHERE id = ?1", [&id])?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("delete_refresh interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn delete_refresh_tokens_for_user(&self, user_id: &str) -> anyhow::Result<()> {
        let user_id = user_id.to_string();
        let conn = self.pool.get().await.context("meta pool get")?;
        conn.interact(move |c| {
            c.execute("DELETE FROM refresh_tokens WHERE user_id = ?1", [&user_id])?;
            Ok::<_, deadpool_sqlite::rusqlite::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("delete_refresh_user interact: {e:?}"))?
        .map_err(|e| anyhow::anyhow!("{e}"))
    }
}

//! **Dragonfly / Redis** 互換ストアへのセッション永続化（`tower-sessions`）。
//! compose の `dragonfly` サービス（既定 `redis://127.0.0.1:6379`）を想定。

use std::fmt::Debug;

use async_trait::async_trait;
use redis::aio::ConnectionManager;
use time::OffsetDateTime;
use tower_sessions::session::{Id, Record};
use tower_sessions::session_store::{self, SessionStore};

#[derive(Clone)]
pub struct DragonflySessionStore {
    conn: ConnectionManager,
    key_prefix: String,
}

impl Debug for DragonflySessionStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DragonflySessionStore")
            .field("key_prefix", &self.key_prefix)
            .finish_non_exhaustive()
    }
}

impl DragonflySessionStore {
    pub async fn connect(redis_url: &str, key_prefix: impl Into<String>) -> anyhow::Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            key_prefix: key_prefix.into(),
        })
    }

    fn redis_key(&self, id: &Id) -> String {
        format!("{}{}", self.key_prefix, id)
    }

    /// `SET ... EXAT` + 任意で `NX` / `XX`。戻り: Redis がキーをセットしたか（`SET` の応答が OK 相当）。
    async fn set_record(
        &self,
        record: &Record,
        nx: bool,
        xx: bool,
    ) -> session_store::Result<bool> {
        let key = self.redis_key(&record.id);
        let payload = serde_json::to_vec(record)
            .map_err(|e| session_store::Error::Encode(e.to_string()))?;
        let exat = record.expiry_date.unix_timestamp();
        let mut c = self.conn.clone();
        let mut cmd = redis::cmd("SET");
        cmd.arg(&key).arg(&payload).arg("EXAT").arg(exat);
        if nx {
            cmd.arg("NX");
        }
        if xx {
            cmd.arg("XX");
        }
        let result: Option<String> = cmd
            .query_async(&mut c)
            .await
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        Ok(result.is_some())
    }
}

#[async_trait]
impl SessionStore for DragonflySessionStore {
    async fn create(&self, record: &mut Record) -> session_store::Result<()> {
        loop {
            if !self.set_record(record, true, false).await? {
                record.id = Id::default();
                continue;
            }
            break;
        }
        Ok(())
    }

    async fn save(&self, record: &Record) -> session_store::Result<()> {
        let _ = self.set_record(record, false, true).await?;
        Ok(())
    }

    async fn load(&self, session_id: &Id) -> session_store::Result<Option<Record>> {
        let key = self.redis_key(session_id);
        let mut c = self.conn.clone();
        let data: Option<Vec<u8>> = redis::cmd("GET")
            .arg(&key)
            .query_async(&mut c)
            .await
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        let Some(data) = data else {
            return Ok(None);
        };
        let record: Record = serde_json::from_slice(&data)
            .map_err(|e| session_store::Error::Decode(e.to_string()))?;
        if record.expiry_date <= OffsetDateTime::now_utc() {
            let _: () = redis::cmd("DEL")
                .arg(&key)
                .query_async(&mut c)
                .await
                .map_err(|e| session_store::Error::Backend(e.to_string()))?;
            return Ok(None);
        }
        Ok(Some(record))
    }

    async fn delete(&self, session_id: &Id) -> session_store::Result<()> {
        let key = self.redis_key(session_id);
        let mut c = self.conn.clone();
        let _: () = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut c)
            .await
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        Ok(())
    }
}

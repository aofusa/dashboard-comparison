//! tower-sessions の **SessionStore** を **moka**（async）で実装（core 0.15 整合）。
//! `tower-sessions-moka-store` 0.15 は tower-sessions-core 0.14 依存のため使わない。

use async_trait::async_trait;
use moka::future::Cache;
use tower_sessions::session::{Id, Record};
use tower_sessions::session_store::{self, SessionStore};

#[derive(Debug, Clone)]
pub struct MokaSessionStore {
    cache: Cache<Id, Record>,
}

impl MokaSessionStore {
    #[must_use]
    pub fn new(max_capacity: u64) -> Self {
        Self {
            cache: Cache::builder().max_capacity(max_capacity).build(),
        }
    }
}

#[async_trait]
impl SessionStore for MokaSessionStore {
    async fn create(&self, record: &mut Record) -> session_store::Result<()> {
        while self.cache.contains_key(&record.id) {
            record.id = Id::default();
        }
        self.cache.insert(record.id, record.clone()).await;
        Ok(())
    }

    async fn save(&self, record: &Record) -> session_store::Result<()> {
        self.cache.insert(record.id, record.clone()).await;
        Ok(())
    }

    async fn load(&self, session_id: &Id) -> session_store::Result<Option<Record>> {
        Ok(self.cache.get(session_id).await)
    }

    async fn delete(&self, session_id: &Id) -> session_store::Result<()> {
        self.cache.invalidate(session_id).await;
        Ok(())
    }
}

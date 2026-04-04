//! `items` 一覧ページの Dragonfly / Redis **read-through** と、書き込み時の **リスト世代 INCR**（P4b）。
//! キャッシュキーに世代を含めるため **SCAN 不要**。`all_items_for_user`（Arrow 全件）はキャッシュしない。

use std::sync::Arc;

use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tracing::{debug, warn};

use crate::content_repository::{
    ContentRepository, DynamoContentRepository, ItemRow, ItemsPage,
};

pub struct WriteThroughContentRepository {
    inner: Arc<DynamoContentRepository>,
    redis: ConnectionManager,
    key_prefix: String,
    ttl_secs: u64,
}

impl WriteThroughContentRepository {
    pub fn new(
        inner: Arc<DynamoContentRepository>,
        redis: ConnectionManager,
        key_prefix: String,
        ttl_secs: u64,
    ) -> Self {
        Self {
            inner,
            redis,
            key_prefix,
            ttl_secs,
        }
    }

    fn ver_key(&self, user_id: &str) -> String {
        format!("{}ver:{}", self.key_prefix, user_id)
    }

    fn page_key(&self, user_id: &str, ver: u64, page: u32, page_size: u32) -> String {
        format!(
            "{}page:{}:{}:{}:{}",
            self.key_prefix, user_id, ver, page, page_size
        )
    }

    async fn list_version(&self, user_id: &str) -> u64 {
        let mut c = self.redis.clone();
        let k = self.ver_key(user_id);
        match c.get::<_, Option<String>>(&k).await {
            Ok(Some(s)) => s.parse().unwrap_or(0),
            Ok(None) => 0,
            Err(e) => {
                warn!(target: "perf_cache", error = %e, "list version GET failed; using 0");
                0
            }
        }
    }

    async fn bump_list_version(&self, user_id: &str) {
        let mut c = self.redis.clone();
        let k = self.ver_key(user_id);
        let r: Result<i64, redis::RedisError> =
            redis::cmd("INCR").arg(&k).query_async(&mut c).await;
        if let Err(e) = r {
            warn!(target: "perf_cache", error = %e, "list version INCR failed");
        }
    }
}

#[async_trait]
impl ContentRepository for WriteThroughContentRepository {
    async fn items_page_for_user(
        &self,
        user_id: &str,
        page: u32,
        page_size: u32,
    ) -> anyhow::Result<ItemsPage> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let ver = self.list_version(user_id).await;
        let pk = self.page_key(user_id, ver, page, page_size);

        let mut c = self.redis.clone();
        match c.get::<_, Option<String>>(&pk).await {
            Ok(Some(json)) => match serde_json::from_str::<ItemsPage>(&json) {
                Ok(p) if p.page == page && p.page_size == page_size => {
                    debug!(
                        target: "perf_cache",
                        user_id = %user_id,
                        page,
                        page_size,
                        "items page cache hit"
                    );
                    return Ok(p);
                }
                Ok(_) => {}
                Err(e) => warn!(target: "perf_cache", error = %e, "cache JSON decode failed"),
            },
            Ok(None) => {}
            Err(e) => warn!(target: "perf_cache", error = %e, "page GET failed"),
        }

        let p = self
            .inner
            .items_page_for_user(user_id, page, page_size)
            .await?;
        if let Ok(json) = serde_json::to_string(&p) {
            let mut c2 = self.redis.clone();
            if let Err(e) = c2.set_ex::<_, _, ()>(&pk, json, self.ttl_secs).await {
                warn!(target: "perf_cache", error = %e, "page SET EX failed");
            }
        }
        Ok(p)
    }

    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64> {
        self.inner.count_items(user_id).await
    }

    async fn list_items_slice(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>> {
        self.inner
            .list_items_slice(user_id, limit, offset)
            .await
    }

    async fn list_items_updated_after(
        &self,
        user_id: &str,
        after_iso: &str,
    ) -> anyhow::Result<Vec<ItemRow>> {
        self.inner
            .list_items_updated_after(user_id, after_iso)
            .await
    }

    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>> {
        self.inner.list_item_ids(user_id).await
    }

    async fn item_title_initial_stats(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<(String, i64)>> {
        self.inner.item_title_initial_stats(user_id).await
    }

    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let row = self.inner.create_item(user_id, title).await?;
        self.bump_list_version(user_id).await;
        Ok(row)
    }

    async fn update_item(&self, user_id: &str, id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let row = self.inner.update_item(user_id, id, title).await?;
        self.bump_list_version(user_id).await;
        Ok(row)
    }

    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<()> {
        self.inner.delete_item(user_id, id).await?;
        self.bump_list_version(user_id).await;
        Ok(())
    }

    async fn all_items_for_user(&self, user_id: &str) -> anyhow::Result<Vec<ItemRow>> {
        self.inner.all_items_for_user(user_id).await
    }
}

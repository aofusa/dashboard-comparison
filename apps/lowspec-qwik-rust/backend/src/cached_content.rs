//! moka weighted cache — 仕様 v1.5.1（Write-through: 変更後に **invalidate_all**）

use std::sync::Arc;

use async_trait::async_trait;
use moka::future::Cache;

use crate::content_repo::{ContentRepository, ItemRow};

fn page_weight(v: &(i64, Vec<ItemRow>)) -> u32 {
    let body: u32 = v
        .1
        .iter()
        .map(|(a, b, c, d)| {
            (a.len() + b.len() + c.len() + d.as_deref().map_or(0, str::len)) as u32
        })
        .sum();
    body.saturating_add(64)
}

#[derive(Clone)]
pub struct MokaCachedContent {
    inner: Arc<dyn ContentRepository>,
    cache: Cache<String, (i64, Vec<ItemRow>)>,
}

impl MokaCachedContent {
    pub fn new(inner: Arc<dyn ContentRepository>, max_weight: u64) -> Self {
        let inner2 = inner.clone();
        let cache = Cache::builder()
            .weigher(|_k, v: &(i64, Vec<ItemRow>)| page_weight(v))
            .max_capacity(max_weight)
            .build();
        Self {
            inner: inner2,
            cache,
        }
    }
}

#[async_trait]
impl ContentRepository for MokaCachedContent {
    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64> {
        self.inner.count_items(user_id).await
    }

    async fn list_items(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>> {
        let key = format!("{user_id}:{limit}:{offset}");
        let inner = self.inner.clone();
        let uid = user_id.to_string();
        let (_total, rows) = self
            .cache
            .try_get_with(key, async move {
                let t = inner.count_items(&uid).await?;
                let rows = inner.list_items(&uid, limit, offset).await?;
                Ok::<_, anyhow::Error>((t, rows))
            })
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(rows)
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

    async fn item_title_initial_stats(&self, user_id: &str) -> anyhow::Result<Vec<(String, i64)>> {
        self.inner.item_title_initial_stats(user_id).await
    }

    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>> {
        self.inner.list_item_ids(user_id).await
    }

    async fn get_item(&self, user_id: &str, id: &str) -> anyhow::Result<Option<ItemRow>> {
        self.inner.get_item(user_id, id).await
    }

    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let row = self.inner.create_item(user_id, title).await?;
        self.cache.invalidate_all();
        Ok(row)
    }

    async fn update_item(
        &self,
        user_id: &str,
        id: &str,
        title: &str,
    ) -> anyhow::Result<Option<ItemRow>> {
        let row = self.inner.update_item(user_id, id, title).await?;
        self.cache.invalidate_all();
        Ok(row)
    }

    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<bool> {
        let ok = self.inner.delete_item(user_id, id).await?;
        self.cache.invalidate_all();
        Ok(ok)
    }
}

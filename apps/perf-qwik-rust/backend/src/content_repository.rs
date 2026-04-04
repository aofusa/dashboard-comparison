//! コンテンツ取得・更新（DynamoDB Query ベース、ページング・件数）

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::dynamo;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemRow {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

/// 1 ページ分の結果（REST / GraphQL で同じセマンティクス）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemsPage {
    pub items: Vec<ItemRow>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

/// lowspec DuckDB と同ルール: 空・空白のみタイトルは `#`、先頭は trim 後 1 文字を大文字化。
pub fn title_initial_letter(title: &str) -> String {
    let t = title.trim();
    if t.is_empty() {
        "#".to_string()
    } else {
        t.chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "#".to_string())
    }
}

#[async_trait]
pub trait ContentRepository: Send + Sync {
    async fn items_page_for_user(
        &self,
        user_id: &str,
        page: u32,
        page_size: u32,
    ) -> anyhow::Result<ItemsPage>;

    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64>;

    async fn list_items_slice(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>>;

    async fn list_items_updated_after(
        &self,
        user_id: &str,
        after_iso: &str,
    ) -> anyhow::Result<Vec<ItemRow>>;

    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>>;

    async fn item_title_initial_stats(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<(String, i64)>>;

    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow>;

    async fn update_item(&self, user_id: &str, id: &str, title: &str) -> anyhow::Result<ItemRow>;

    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<()>;

    /// 当該ユーザーの全件（ページングで Dynamo Query）。**Arrow エクスポート**用。
    async fn all_items_for_user(&self, user_id: &str) -> anyhow::Result<Vec<ItemRow>>;
}

pub struct DynamoContentRepository {
    pub client: aws_sdk_dynamodb::Client,
    pub table: String,
}

#[async_trait]
impl ContentRepository for DynamoContentRepository {
    async fn items_page_for_user(
        &self,
        user_id: &str,
        page: u32,
        page_size: u32,
    ) -> anyhow::Result<ItemsPage> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let limit = page_size as i32;

        let total = dynamo::count_items_for_user(&self.client, &self.table, user_id).await?;

        let mut eks: Option<std::collections::HashMap<String, aws_sdk_dynamodb::types::AttributeValue>> =
            None;
        if page > 1 {
            let skip_pages = page - 1;
            for _ in 0..skip_pages {
                let (_, next) = dynamo::query_user_items_page(
                    &self.client,
                    &self.table,
                    user_id,
                    limit,
                    eks.take(),
                )
                .await?;
                eks = next;
                if eks.is_none() {
                    return Ok(ItemsPage {
                        items: vec![],
                        total,
                        page,
                        page_size,
                    });
                }
            }
        }

        let (rows, _) = dynamo::query_user_items_page(
            &self.client,
            &self.table,
            user_id,
            limit,
            eks,
        )
        .await?;

        let items = rows
            .into_iter()
            .map(|(id, title, updated_at)| ItemRow {
                id,
                title,
                updated_at,
            })
            .collect();

        Ok(ItemsPage {
            items,
            total,
            page,
            page_size,
        })
    }

    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64> {
        dynamo::count_items_for_user(&self.client, &self.table, user_id).await
    }

    async fn list_items_slice(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>> {
        let mut rows = dynamo::query_all_user_items(&self.client, &self.table, user_id, 500).await?;
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        let off = offset.max(0) as usize;
        let lim = limit.clamp(1, 100_000) as usize;
        Ok(rows
            .into_iter()
            .skip(off)
            .take(lim)
            .map(|(id, title, updated_at)| ItemRow {
                id,
                title,
                updated_at,
            })
            .collect())
    }

    async fn list_items_updated_after(
        &self,
        user_id: &str,
        after_iso: &str,
    ) -> anyhow::Result<Vec<ItemRow>> {
        let threshold = after_iso.trim();
        let rows = dynamo::query_all_user_items(&self.client, &self.table, user_id, 500).await?;
        Ok(rows
            .into_iter()
            .filter(|(_, _, ua)| ua.as_str() > threshold)
            .map(|(id, title, updated_at)| ItemRow {
                id,
                title,
                updated_at,
            })
            .collect())
    }

    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>> {
        let mut rows = dynamo::query_all_user_items(&self.client, &self.table, user_id, 500).await?;
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(rows.into_iter().map(|(id, _, _)| id).collect())
    }

    async fn item_title_initial_stats(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<(String, i64)>> {
        let rows = dynamo::query_all_user_items(&self.client, &self.table, user_id, 500).await?;
        let mut m: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
        for (_, title, _) in rows {
            let letter = title_initial_letter(&title);
            *m.entry(letter).or_insert(0) += 1;
        }
        Ok(m.into_iter().collect())
    }

    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let id = uuid::Uuid::new_v4().to_string();
        let updated_at =
            dynamo::put_item(&self.client, &self.table, &id, user_id, title).await?;
        Ok(ItemRow {
            id,
            title: title.to_string(),
            updated_at,
        })
    }

    async fn update_item(&self, user_id: &str, id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let (rid, t, u) =
            dynamo::update_user_item(&self.client, &self.table, user_id, id, title).await?;
        Ok(ItemRow {
            id: rid,
            title: t,
            updated_at: u,
        })
    }

    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<()> {
        dynamo::delete_user_item(&self.client, &self.table, user_id, id).await
    }

    async fn all_items_for_user(&self, user_id: &str) -> anyhow::Result<Vec<ItemRow>> {
        let rows = dynamo::query_all_user_items(&self.client, &self.table, user_id, 500).await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, updated_at)| ItemRow {
                id,
                title,
                updated_at,
            })
            .collect())
    }
}

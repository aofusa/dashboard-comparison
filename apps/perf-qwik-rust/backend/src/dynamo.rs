//! DynamoDB（Alternator 可）— PK `user_id` + SK `id`。**Query** ベース。P2: `updated_at`（RFC3339）。

use std::collections::HashMap;

use anyhow::Context;
use aws_sdk_dynamodb::types::{AttributeDefinition, AttributeValue, KeySchemaElement, KeyType};
use aws_sdk_dynamodb::types::ReturnValue::AllNew;
use aws_sdk_dynamodb::types::ScalarAttributeType::S;
use aws_sdk_dynamodb::types::Select;
use aws_sdk_dynamodb::Client;

pub fn utc_rfc3339_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn dynamo_conditional_failed(e: &dyn std::fmt::Debug) -> bool {
    let s = format!("{e:?}");
    s.contains("ConditionalCheckFailed") || s.contains("conditional request failed")
}

fn parse_item_attrs(
    attrs: &HashMap<String, AttributeValue>,
) -> anyhow::Result<(String, String, String)> {
    let id = attrs
        .get("id")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.as_str().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing id"))?;
    let title = attrs
        .get("title")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.as_str().to_string())
        .unwrap_or_default();
    let updated_at = attrs
        .get("updated_at")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.as_str().to_string())
        .unwrap_or_default();
    Ok((id, title, updated_at))
}

/// P1 テーブル: パーティション `user_id`、ソート `id`（ユーザー別 Query）
pub async fn ensure_table(client: &Client, table: &str) -> anyhow::Result<()> {
    let names = client.list_tables().send().await?;
    if !names.table_names().iter().any(|t| t == table) {
        create_table_p1(client, table).await?;
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        return Ok(());
    }

    let desc = client
        .describe_table()
        .table_name(table)
        .send()
        .await
        .context("describe_table")?;
    let tbl = desc
        .table()
        .ok_or_else(|| anyhow::anyhow!("describe_table: empty"))?;
    if !table_key_schema_is_p1(tbl.key_schema()) {
        anyhow::bail!(
            "DynamoDB table \"{}\" のキーが P1 と非互換です（要: HASH user_id + RANGE id）。\
             テーブルを削除するか `DYNAMODB_TABLE` に新名を指定してください。\
             詳細: apps/perf-qwik-rust/README.md（P1 移行）",
            table
        );
    }
    Ok(())
}

fn table_key_schema_is_p1(schema: &[aws_sdk_dynamodb::types::KeySchemaElement]) -> bool {
    let mut has_user_pk = false;
    let mut has_id_sk = false;
    for el in schema {
        let name = el.attribute_name();
        match el.key_type() {
            KeyType::Hash => {
                if name == "user_id" {
                    has_user_pk = true;
                }
            }
            KeyType::Range => {
                if name == "id" {
                    has_id_sk = true;
                }
            }
            _ => {}
        }
    }
    has_user_pk && has_id_sk
}

async fn create_table_p1(client: &Client, table: &str) -> anyhow::Result<()> {
    let hash = KeySchemaElement::builder()
        .attribute_name("user_id")
        .key_type(KeyType::Hash)
        .build()
        .map_err(|e| anyhow::anyhow!("key_schema hash: {e}"))?;
    let range = KeySchemaElement::builder()
        .attribute_name("id")
        .key_type(KeyType::Range)
        .build()
        .map_err(|e| anyhow::anyhow!("key_schema range: {e}"))?;
    let ad_u = AttributeDefinition::builder()
        .attribute_name("user_id")
        .attribute_type(S)
        .build()
        .map_err(|e| anyhow::anyhow!("attr user_id: {e}"))?;
    let ad_i = AttributeDefinition::builder()
        .attribute_name("id")
        .attribute_type(S)
        .build()
        .map_err(|e| anyhow::anyhow!("attr id: {e}"))?;
    client
        .create_table()
        .table_name(table)
        .key_schema(hash)
        .key_schema(range)
        .attribute_definitions(ad_u)
        .attribute_definitions(ad_i)
        .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest)
        .send()
        .await
        .context("create_table P1")?;
    Ok(())
}

/// 書き込んだ **`updated_at`（RFC3339）** を返す。
pub async fn put_item(
    client: &Client,
    table: &str,
    id: &str,
    user_id: &str,
    title: &str,
) -> anyhow::Result<String> {
    let updated_at = utc_rfc3339_now();
    client
        .put_item()
        .table_name(table)
        .item("user_id", AttributeValue::S(user_id.to_string()))
        .item("id", AttributeValue::S(id.to_string()))
        .item("title", AttributeValue::S(title.to_string()))
        .item("updated_at", AttributeValue::S(updated_at.clone()))
        .send()
        .await?;
    Ok(updated_at)
}

/// `user_id` 等価条件で **最大 `limit` 件**を Query。戻り: `(id, title, updated_at)`。
pub async fn query_user_items_page(
    client: &Client,
    table: &str,
    user_id: &str,
    limit: i32,
    exclusive_start_key: Option<HashMap<String, AttributeValue>>,
) -> anyhow::Result<(
    Vec<(String, String, String)>,
    Option<HashMap<String, AttributeValue>>,
)> {
    let mut req = client
        .query()
        .table_name(table)
        .key_condition_expression("user_id = :u")
        .expression_attribute_values(":u", AttributeValue::S(user_id.to_string()))
        .limit(limit);
    if let Some(ek) = exclusive_start_key {
        req = req.set_exclusive_start_key(Some(ek));
    }
    let resp = req.send().await.context("query items page")?;
    let mut out = Vec::new();
    for item in resp.items() {
        let id = item
            .get("id")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.as_str().to_string())
            .unwrap_or_default();
        let title = item
            .get("title")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.as_str().to_string())
            .unwrap_or_default();
        let updated_at = item
            .get("updated_at")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.as_str().to_string())
            .unwrap_or_default();
        if !id.is_empty() {
            out.push((id, title, updated_at));
        }
    }
    Ok((out, resp.last_evaluated_key.clone()))
}

/// Query + `Select::Count` をページングし、件数合計を返す。
pub async fn count_items_for_user(
    client: &Client,
    table: &str,
    user_id: &str,
) -> anyhow::Result<i64> {
    let mut total: i64 = 0;
    let mut eks: Option<HashMap<String, AttributeValue>> = None;
    loop {
        let mut req = client
            .query()
            .table_name(table)
            .key_condition_expression("user_id = :u")
            .expression_attribute_values(":u", AttributeValue::S(user_id.to_string()))
            .select(Select::Count);
        if let Some(k) = eks.take() {
            req = req.set_exclusive_start_key(Some(k));
        }
        let resp = req.send().await.context("query count")?;
        total += resp.count() as i64;
        eks = resp.last_evaluated_key.clone();
        if eks.is_none() {
            break;
        }
    }
    Ok(total)
}

pub async fn update_user_item(
    client: &Client,
    table: &str,
    user_id: &str,
    item_id: &str,
    title: &str,
) -> anyhow::Result<(String, String, String)> {
    let updated_at = utc_rfc3339_now();
    let out = client
        .update_item()
        .table_name(table)
        .key("user_id", AttributeValue::S(user_id.to_string()))
        .key("id", AttributeValue::S(item_id.to_string()))
        .update_expression("SET title = :t, updated_at = :ua")
        .expression_attribute_values(":t", AttributeValue::S(title.to_string()))
        .expression_attribute_values(":ua", AttributeValue::S(updated_at))
        .condition_expression("attribute_exists(id)")
        .return_values(AllNew)
        .send()
        .await
        .map_err(|e| {
            if dynamo_conditional_failed(&e) {
                anyhow::anyhow!("not_found")
            } else {
                anyhow::Error::from(e)
            }
        })?;
    let attrs = out
        .attributes()
        .ok_or_else(|| anyhow::anyhow!("update_item: no attributes"))?;
    parse_item_attrs(attrs)
}

/// `user_id` 配下の全アイテムを **Query ページング**で収集（Arrow エクスポート等）。1 ページ最大 `page_limit` 件。
pub async fn query_all_user_items(
    client: &Client,
    table: &str,
    user_id: &str,
    page_limit: i32,
) -> anyhow::Result<Vec<(String, String, String)>> {
    let limit = page_limit.clamp(1, 1000);
    let mut all = Vec::new();
    let mut eks: Option<HashMap<String, AttributeValue>> = None;
    loop {
        let (page, next) =
            query_user_items_page(client, table, user_id, limit, eks.take()).await?;
        all.extend(page);
        eks = next;
        if eks.is_none() {
            break;
        }
    }
    Ok(all)
}

pub async fn delete_user_item(
    client: &Client,
    table: &str,
    user_id: &str,
    item_id: &str,
) -> anyhow::Result<()> {
    client
        .delete_item()
        .table_name(table)
        .key("user_id", AttributeValue::S(user_id.to_string()))
        .key("id", AttributeValue::S(item_id.to_string()))
        .condition_expression("attribute_exists(id)")
        .send()
        .await
        .map_err(|e| {
            if dynamo_conditional_failed(&e) {
                anyhow::anyhow!("not_found")
            } else {
                anyhow::Error::from(e)
            }
        })?;
    Ok(())
}

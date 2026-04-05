//! ContentRepository — **Embedded DuckDB**（仕様 v1.5.1）。
//! mpsc 単一ライター、`updated_at`、CRUD。読み取りは `spawn_blocking`。

use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;

use anyhow::Context;
use async_trait::async_trait;
use duckdb::params;
use tracing::{error, warn};

/// `(id, title, user_id, updated_at_iso)`
pub type ItemRow = (String, String, String, Option<String>);

type RowsAffectedTx = std::sync::mpsc::Sender<anyhow::Result<usize>>;
type ItemRowTx = std::sync::mpsc::Sender<anyhow::Result<ItemRow>>;
type ItemRowOptTx = std::sync::mpsc::Sender<anyhow::Result<Option<ItemRow>>>;

/// 読み取り専用コネクションの `list_item_ids` / `items_slice` が WAL 直後に追いつかないと、
/// フロントの `itemsDbReconcileIds` が新規行を誤削除するため、書き込み後に WAL を同期する。
fn content_writer_checkpoint(conn: &duckdb::Connection) {
    if let Err(e) = conn.execute("CHECKPOINT", []) {
        warn!(error = %e, "content db CHECKPOINT after write");
    }
}

#[derive(Debug)]
enum ContentWrite {
    ExecBatch(String),
    CreateItem {
        id: String,
        user_id: String,
        title: String,
        reply: ItemRowTx,
    },
    UpdateItem {
        id: String,
        user_id: String,
        title: String,
        reply: ItemRowOptTx,
    },
    DeleteItem {
        id: String,
        user_id: String,
        reply: RowsAffectedTx,
    },
}

#[derive(Clone)]
pub struct ContentWriter {
    tx: Sender<ContentWrite>,
}

impl ContentWriter {
    pub fn spawn(content_path: String) -> Self {
        let (tx, rx) = mpsc::channel::<ContentWrite>();
        thread::spawn(move || {
            let conn = match duckdb::Connection::open(&content_path) {
                Ok(c) => c,
                Err(e) => {
                    error!("content db writer open: {e}");
                    return;
                }
            };
            if let Err(e) = conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS items (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    title VARCHAR NOT NULL
                );",
            ) {
                error!("content db init: {e}");
                return;
            }
            let _ = conn.execute_batch(
                "ALTER TABLE items ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;",
            );
            while let Ok(msg) = rx.recv() {
                match msg {
                    ContentWrite::ExecBatch(sql) => {
                        if let Err(e) = conn.execute_batch(&sql) {
                            error!("content db exec: {e}");
                        }
                    }
                    ContentWrite::CreateItem {
                        id,
                        user_id,
                        title,
                        reply,
                    } => {
                        let res = (|| -> anyhow::Result<ItemRow> {
                            let n = conn
                                .execute(
                                    "INSERT INTO items (id, user_id, title, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                                    params![&id, &user_id, &title],
                                )
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            if n == 0 {
                                anyhow::bail!("create_item: no row inserted");
                            }
                            let mut stmt = conn
                                .prepare(
                                    "SELECT id, title, user_id, \
                                     CASE WHEN updated_at IS NULL THEN NULL ELSE CAST(updated_at AS VARCHAR) END \
                                     FROM items WHERE id = ? AND user_id = ?",
                                )
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            let mut rows = stmt
                                .query(params![id.as_str(), user_id.as_str()])
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            let Some(row) = rows.next().map_err(|e| anyhow::anyhow!("{e}"))? else {
                                warn!(
                                    user_id = %user_id,
                                    item_id = %id,
                                    "create_item: row missing after insert on writer connection"
                                );
                                anyhow::bail!("create_item: row missing after insert");
                            };
                            Ok((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                            ))
                        })();
                        if res.is_ok() {
                            content_writer_checkpoint(&conn);
                        }
                        let _ = reply.send(res);
                    }
                    ContentWrite::UpdateItem {
                        id,
                        user_id,
                        title,
                        reply,
                    } => {
                        let res = (|| -> anyhow::Result<Option<ItemRow>> {
                            let n = conn
                                .execute(
                                    "UPDATE items SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
                                    params![&title, &id, &user_id],
                                )
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            if n == 0 {
                                return Ok(None);
                            }
                            let mut stmt = conn
                                .prepare(
                                    "SELECT id, title, user_id, \
                                     CASE WHEN updated_at IS NULL THEN NULL ELSE CAST(updated_at AS VARCHAR) END \
                                     FROM items WHERE id = ? AND user_id = ?",
                                )
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            let mut rows = stmt
                                .query(params![id.as_str(), user_id.as_str()])
                                .map_err(|e| anyhow::anyhow!("{e}"))?;
                            let Some(row) = rows.next().map_err(|e| anyhow::anyhow!("{e}"))? else {
                                warn!(
                                    user_id = %user_id,
                                    item_id = %id,
                                    "update_item: row missing after update on writer connection"
                                );
                                anyhow::bail!("update_item: row missing after update");
                            };
                            Ok(Some((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                            )))
                        })();
                        if matches!(res, Ok(Some(_))) {
                            content_writer_checkpoint(&conn);
                        }
                        let _ = reply.send(res);
                    }
                    ContentWrite::DeleteItem { id, user_id, reply } => {
                        let res = conn
                            .execute(
                                "DELETE FROM items WHERE id = ? AND user_id = ?",
                                params![id, user_id],
                            )
                            .map_err(|e| anyhow::anyhow!("{e}"));
                        if matches!(&res, Ok(n) if *n > 0) {
                            content_writer_checkpoint(&conn);
                        }
                        let _ = reply.send(res);
                    }
                }
            }
        });
        Self { tx }
    }

    pub fn exec_sql(&self, sql: String) -> anyhow::Result<()> {
        self.tx
            .send(ContentWrite::ExecBatch(sql))
            .map_err(|_| anyhow::anyhow!("content writer channel closed"))?;
        Ok(())
    }

    pub fn create_item_blocking(
        &self,
        id: String,
        user_id: String,
        title: String,
    ) -> anyhow::Result<ItemRow> {
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        self.tx
            .send(ContentWrite::CreateItem {
                id,
                user_id,
                title,
                reply: reply_tx,
            })
            .map_err(|_| anyhow::anyhow!("content writer channel closed"))?;
        reply_rx
            .recv()
            .map_err(|_| anyhow::anyhow!("content writer reply closed"))?
    }

    pub fn update_item_blocking(
        &self,
        id: String,
        user_id: String,
        title: String,
    ) -> anyhow::Result<Option<ItemRow>> {
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        self.tx
            .send(ContentWrite::UpdateItem {
                id,
                user_id,
                title,
                reply: reply_tx,
            })
            .map_err(|_| anyhow::anyhow!("content writer channel closed"))?;
        reply_rx
            .recv()
            .map_err(|_| anyhow::anyhow!("content writer reply closed"))?
    }

    pub fn delete_item_blocking(&self, id: String, user_id: String) -> anyhow::Result<usize> {
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        self.tx
            .send(ContentWrite::DeleteItem {
                id,
                user_id,
                reply: reply_tx,
            })
            .map_err(|_| anyhow::anyhow!("content writer channel closed"))?;
        reply_rx
            .recv()
            .map_err(|_| anyhow::anyhow!("content writer reply closed"))?
    }
}

#[async_trait]
pub trait ContentRepository: Send + Sync {
    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64>;
    async fn list_items(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>>;
    /// `updated_at` が `after_iso` より後の行のみ（差分同期用）。キャッシュしない実装を推奨。
    async fn list_items_updated_after(
        &self,
        user_id: &str,
        after_iso: &str,
    ) -> anyhow::Result<Vec<ItemRow>>;
    /// タイトル先頭 1 文字（空タイトルは `#`）ごとの件数。
    async fn item_title_initial_stats(&self, user_id: &str) -> anyhow::Result<Vec<(String, i64)>>;
    /// 当該ユーザーの全 item id（削除伝播・リコンシリ用）。キャッシュしない実装を推奨。
    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>>;
    /// 単一行取得（更新直後の応答用。キャッシュを挟まない実装を推奨）。
    async fn get_item(&self, user_id: &str, id: &str) -> anyhow::Result<Option<ItemRow>>;
    /// 挿入直後の行（ライター接続上で SELECT 済み）。
    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow>;
    /// 更新後の行。該当なしのとき `None`。
    async fn update_item(
        &self,
        user_id: &str,
        id: &str,
        title: &str,
    ) -> anyhow::Result<Option<ItemRow>>;
    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<bool>;
}

#[derive(Clone)]
pub struct DuckDbContentRepository {
    path: Arc<String>,
    writer: ContentWriter,
}

impl DuckDbContentRepository {
    pub fn new(content_path: String) -> anyhow::Result<Self> {
        let path = Arc::new(content_path);
        {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open init")?;
            c.execute_batch(
                "CREATE TABLE IF NOT EXISTS items (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    title VARCHAR NOT NULL
                );",
            )?;
            let _ = c.execute_batch(
                "ALTER TABLE items ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;",
            );
        }
        let writer = ContentWriter::spawn(path.as_str().to_string());
        Ok(Self { path, writer })
    }

    pub fn writer(&self) -> &ContentWriter {
        &self.writer
    }

    pub fn path(&self) -> &str {
        self.path.as_str()
    }
}

#[async_trait]
impl ContentRepository for DuckDbContentRepository {
    async fn count_items(&self, user_id: &str) -> anyhow::Result<i64> {
        let uid = user_id.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare("SELECT COUNT(*)::BIGINT FROM items WHERE user_id = ?")
                .context("prepare count")?;
            let n: i64 = stmt
                .query_row(params![uid], |r| r.get(0))
                .context("query count")?;
            Ok(n)
        })
        .await?
    }

    async fn list_items(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ItemRow>> {
        let uid = user_id.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare(
                    "SELECT id, title, user_id, \
                     CASE WHEN updated_at IS NULL THEN NULL ELSE CAST(updated_at AS VARCHAR) END \
                     FROM items WHERE user_id = ? ORDER BY id LIMIT ? OFFSET ?",
                )
                .context("prepare list")?;
            let mut rows = stmt.query(params![uid, limit, offset]).context("query")?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().context("next row")? {
                out.push((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?));
            }
            Ok(out)
        })
        .await?
    }

    async fn list_items_updated_after(
        &self,
        user_id: &str,
        after_iso: &str,
    ) -> anyhow::Result<Vec<ItemRow>> {
        let uid = user_id.to_string();
        let after = after_iso.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare(
                    "SELECT id, title, user_id, \
                     CASE WHEN updated_at IS NULL THEN NULL ELSE CAST(updated_at AS VARCHAR) END \
                     FROM items WHERE user_id = ? \
                     AND updated_at IS NOT NULL AND CAST(updated_at AS TIMESTAMP) > CAST(? AS TIMESTAMP) \
                     ORDER BY updated_at",
                )
                .context("prepare list updated_after")?;
            let mut rows = stmt
                .query(params![uid, after.as_str()])
                .context("query")?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().context("next row")? {
                out.push((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?));
            }
            Ok(out)
        })
        .await?
    }

    async fn item_title_initial_stats(&self, user_id: &str) -> anyhow::Result<Vec<(String, i64)>> {
        let uid = user_id.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare(
                    "SELECT CASE WHEN length(trim(title)) = 0 THEN '#' \
                     ELSE UPPER(SUBSTR(trim(title), 1, 1)) END AS initial, COUNT(*)::BIGINT AS n \
                     FROM items WHERE user_id = ? \
                     GROUP BY 1 ORDER BY 1",
                )
                .context("prepare stats")?;
            let mut rows = stmt.query(params![uid]).context("query stats")?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().context("next stats row")? {
                let letter: String = row.get(0)?;
                let n: i64 = row.get(1)?;
                out.push((letter, n));
            }
            Ok(out)
        })
        .await?
    }

    async fn list_item_ids(&self, user_id: &str) -> anyhow::Result<Vec<String>> {
        let uid = user_id.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare("SELECT id FROM items WHERE user_id = ? ORDER BY id")
                .context("prepare list ids")?;
            let mut rows = stmt.query(params![uid]).context("query ids")?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().context("next id row")? {
                out.push(row.get(0)?);
            }
            Ok(out)
        })
        .await?
    }

    async fn get_item(&self, user_id: &str, id: &str) -> anyhow::Result<Option<ItemRow>> {
        let uid = user_id.to_string();
        let iid = id.to_string();
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let c = duckdb::Connection::open(path.as_str()).context("content duckdb open")?;
            let mut stmt = c
                .prepare(
                    "SELECT id, title, user_id, \
                     CASE WHEN updated_at IS NULL THEN NULL ELSE CAST(updated_at AS VARCHAR) END \
                     FROM items WHERE id = ? AND user_id = ?",
                )
                .context("prepare get_item")?;
            let mut rows = stmt
                .query(params![iid.as_str(), uid.as_str()])
                .context("query get_item")?;
            let Some(row) = rows.next().context("get_item row")? else {
                return Ok(None);
            };
            Ok(Some((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
            )))
        })
        .await?
    }

    async fn create_item(&self, user_id: &str, title: &str) -> anyhow::Result<ItemRow> {
        let id = uuid::Uuid::new_v4().to_string();
        let w = self.writer.clone();
        let uid = user_id.to_string();
        let tid = id;
        let ttitle = title.to_string();
        tokio::task::spawn_blocking(move || w.create_item_blocking(tid, uid, ttitle)).await?
    }

    async fn update_item(
        &self,
        user_id: &str,
        id: &str,
        title: &str,
    ) -> anyhow::Result<Option<ItemRow>> {
        let w = self.writer.clone();
        let id = id.to_string();
        let uid = user_id.to_string();
        let title = title.to_string();
        tokio::task::spawn_blocking(move || w.update_item_blocking(id, uid, title)).await?
    }

    async fn delete_item(&self, user_id: &str, id: &str) -> anyhow::Result<bool> {
        let w = self.writer.clone();
        let id = id.to_string();
        let uid = user_id.to_string();
        let n = tokio::task::spawn_blocking(move || w.delete_item_blocking(id, uid)).await??;
        Ok(n > 0)
    }
}

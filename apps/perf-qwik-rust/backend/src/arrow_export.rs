//! Dynamo の items → Arrow IPC ストリーム → Zstd。
//! 列は lowspec の DuckDB エクスポートと揃える: `id`, `title`, `user_id`, `updated_at`（UTF-8）。

use std::sync::Arc;

use anyhow::Context;
use arrow::array::StringArray;
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use arrow_ipc::writer::StreamWriter;

use crate::content_repository::{ContentRepository, ItemRow};

pub fn encode_items_arrow_zstd(user_id: &str, mut rows: Vec<ItemRow>) -> anyhow::Result<Vec<u8>> {
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let n = rows.len();
    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    let titles: Vec<&str> = rows.iter().map(|r| r.title.as_str()).collect();
    let uids: Vec<&str> = (0..n).map(|_| user_id).collect();
    let uas: Vec<&str> = rows.iter().map(|r| r.updated_at.as_str()).collect();

    let schema = Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("title", DataType::Utf8, false),
        Field::new("user_id", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
    ]));

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(StringArray::from(ids)),
            Arc::new(StringArray::from(titles)),
            Arc::new(StringArray::from(uids)),
            Arc::new(StringArray::from(uas)),
        ],
    )
    .context("record batch")?;

    let mut buf = Vec::new();
    {
        let mut w = StreamWriter::try_new(&mut buf, &schema).context("stream writer")?;
        w.write(&batch).context("write batch")?;
        w.finish().context("finish ipc")?;
    }
    zstd::encode_all(&buf[..], 3).map_err(|e| anyhow::anyhow!("zstd: {e}"))
}

pub async fn items_arrow_ipc_zstd_for_user(
    content: Arc<dyn ContentRepository>,
    user_id: String,
) -> anyhow::Result<Vec<u8>> {
    let rows = content.all_items_for_user(&user_id).await?;
    tokio::task::spawn_blocking(move || encode_items_arrow_zstd(&user_id, rows)).await?
}

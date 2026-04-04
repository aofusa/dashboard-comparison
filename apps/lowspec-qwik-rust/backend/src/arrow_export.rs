//! DuckDB → Arrow IPC ストリーム → Zstd（仕様 v1.5.1）

use anyhow::Context;
use arrow_ipc::writer::StreamWriter;
use duckdb::params;

/// ユーザーの items を Arrow IPC（ストリーム）にし、Zstd 圧縮したバイト列を返す。
pub async fn items_arrow_ipc_zstd(path: &str, user_id: &str) -> anyhow::Result<Vec<u8>> {
    let path = path.to_string();
    let user_id = user_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = duckdb::Connection::open(path.as_str()).context("duckdb open arrow")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, user_id, CAST(updated_at AS VARCHAR) AS updated_at \
                 FROM items WHERE user_id = ? ORDER BY id",
            )
            .context("prepare arrow")?;
        let mut arrow = stmt.query_arrow(params![user_id]).context("query_arrow")?;
        let schema = arrow.get_schema();
        let batches: Vec<duckdb::arrow::record_batch::RecordBatch> = arrow.collect();
        let mut buf = Vec::new();
        {
            let mut w = StreamWriter::try_new(&mut buf, schema.as_ref()).context("stream writer")?;
            for b in &batches {
                w.write(b).context("write batch")?;
            }
            w.finish().context("finish ipc")?;
        }
        zstd::encode_all(&buf[..], 3).map_err(|e| anyhow::anyhow!("zstd: {e}"))
    })
    .await?
}

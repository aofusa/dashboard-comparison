/**
 * バックエンドの Arrow IPC ストリーム（Zstd 圧縮）をブラウザで展開してプレビュー用に行化する。
 * 動的 import のみ（SSR で Node 向けバンドルを引き込みにくくする）。
 */

export type ArrowPreviewRow = Record<string, string>;

export type ArrowPreview = {
  rowCount: number;
  previewLimit: number;
  columns: string[];
  rows: ArrowPreviewRow[];
};

const PREVIEW_MAX = 50;

/** Zstd 展開後の Arrow IPC ストリームとプレビュー（DuckDB-WASM 用に ipc を再利用）。 */
export async function decodeArrowZstdFull(compressed: ArrayBuffer): Promise<{
  ipcStream: Uint8Array;
  preview: ArrowPreview;
}> {
  const [{ decompress }, { tableFromIPC }] = await Promise.all([
    import("fzstd"),
    import("apache-arrow"),
  ]);

  const ipcStream = decompress(new Uint8Array(compressed));
  const table = tableFromIPC(ipcStream);
  const columns = table.schema.fields.map((f) => f.name);
  const limit = Math.min(PREVIEW_MAX, table.numRows);
  const rows: ArrowPreviewRow[] = [];

  for (let i = 0; i < limit; i++) {
    const row: ArrowPreviewRow = {};
    for (const name of columns) {
      const col = table.getChild(name as keyof typeof table);
      const v = col?.get(i);
      row[name] = v == null ? "" : String(v);
    }
    rows.push(row);
  }

  return {
    ipcStream,
    preview: {
      rowCount: table.numRows,
      previewLimit: limit,
      columns,
      rows,
    },
  };
}

export async function decodeArrowZstdPreview(
  compressed: ArrayBuffer,
): Promise<ArrowPreview> {
  const { preview } = await decodeArrowZstdFull(compressed);
  return preview;
}

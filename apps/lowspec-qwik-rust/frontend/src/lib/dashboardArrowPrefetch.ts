import { apiItemsArrowBuffer, apiItemsList } from "./api";
import { decodeArrowZstdFull } from "./arrowZstd";
import {
  itemsDbApplyDelta,
  itemsDbReplaceAllFromArrow,
  itemsDbTruncate,
} from "./itemsDbClient";
import { tryWriteArrowIpcToOpfs } from "./opfsArrowCache";

const APP_ITEMS_LIMIT = 65535;

/**
 * DuckDB WASM 初期化と並列で走らせる: メインスレッド上で Arrow 取得 + Zstd 展開まで完了させる。
 */
export function startArrowIpcPrefetch(
  signal: AbortSignal,
): Promise<{ ok: true; ipc: Uint8Array } | { ok: false }> {
  return (async () => {
    try {
      const buf = await apiItemsArrowBuffer();
      if (signal.aborted) return { ok: false };
      const { ipcStream } = await decodeArrowZstdFull(buf);
      if (signal.aborted) return { ok: false };
      return { ok: true, ipc: ipcStream };
    } catch {
      return { ok: false };
    }
  })();
}

export async function fullResyncListFallback(
  signal: AbortSignal,
): Promise<void> {
  const rows = await apiItemsList({ limit: APP_ITEMS_LIMIT });
  if (signal.aborted) return;
  await itemsDbTruncate();
  if (rows.length > 0) {
    await itemsDbApplyDelta({ upserts: rows });
  }
}

/** 先に開始した prefetch の結果で入替え、失敗時は GraphQL 一覧にフォールバック */
export async function applyFullResyncFromPrefetch(
  prefetch: Promise<{ ok: true; ipc: Uint8Array } | { ok: false }>,
  signal: AbortSignal,
): Promise<void> {
  const r = await prefetch;
  if (r.ok) {
    if (signal.aborted) return;
    await itemsDbReplaceAllFromArrow(r.ipc);
    void tryWriteArrowIpcToOpfs(r.ipc);
    return;
  }
  await fullResyncListFallback(signal);
}

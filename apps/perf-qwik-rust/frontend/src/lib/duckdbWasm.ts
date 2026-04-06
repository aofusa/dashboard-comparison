import {
  itemsDbSmokeQuery,
  type DuckdbSmokeResult,
} from "./itemsDbClient";

export type DuckdbArrowSmokeResult = DuckdbSmokeResult;

/**
 * 同一 DuckDB Worker 上で一時テーブルに Arrow を載せたスモーク照会（デバッグ用）。
 */
export async function queryArrowIpcSmoke(
  ipc: Uint8Array,
): Promise<DuckdbArrowSmokeResult> {
  return itemsDbSmokeQuery(ipc);
}

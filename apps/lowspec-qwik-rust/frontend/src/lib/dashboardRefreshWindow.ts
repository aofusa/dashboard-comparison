import type { Signal } from "@builder.io/qwik";
import type { ItemRow } from "~/lib/api";
import { itemsDbQueryWindow } from "~/lib/itemsDbClient";
import {
  computeQuerySpan,
  hysteresisQueryWindowCanSkip,
  queryWindowKey,
  scrollStartRow,
  VISIBLE_DATA_ROW_COUNT,
} from "~/lib/dashboardVirtualWindow";

/** `routes/app/index.tsx` の queryWindow 状態。component$ 内に async 関数を置かないためモジュールへ分離。 */
export type DashboardQueryWindowDeps = {
  virtScrollTop: Signal<number>;
  filter: Signal<string>;
  sortKey: Signal<"id" | "title" | "updated_at">;
  sortAsc: Signal<boolean>;
  queryWindowGen: Signal<number>;
  bufferRows: Signal<ItemRow[]>;
  bufferOffset: Signal<number>;
  bufferRangeStart: Signal<number>;
  bufferRangeEnd: Signal<number>;
  bufferQueryKey: Signal<string>;
  windowTotal: Signal<number>;
};

/**
 * 世代付きで queryWindow を適用。ヒステリシスは needEnd=min(start+visible,total) で末尾でも効く。
 * RPC はキャンセル不可のため完了後に myGen を検証する。
 */
export async function refreshDashboardQueryWindow(
  s: DashboardQueryWindowDeps,
  force: boolean,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const start = scrollStartRow(s.virtScrollTop.value);
  const count = VISIBLE_DATA_ROW_COUNT;
  const qKey = queryWindowKey(
    s.filter.value,
    s.sortKey.value,
    s.sortAsc.value,
  );
  if (
    !force &&
    hysteresisQueryWindowCanSkip({
      sameQueryKey: qKey === s.bufferQueryKey.value,
      start,
      visibleCount: count,
      total: s.windowTotal.value,
      bufferRangeStart: s.bufferRangeStart.value,
      bufferRangeEnd: s.bufferRangeEnd.value,
    })
  ) {
    return;
  }
  s.queryWindowGen.value += 1;
  const myGen = s.queryWindowGen.value;
  const { offset, limit } = computeQuerySpan(start);
  const r = await itemsDbQueryWindow({
    filter: s.filter.value,
    sortKey: s.sortKey.value,
    sortAsc: s.sortAsc.value,
    offset,
    limit,
  });
  if (signal?.aborted) return;
  if (myGen !== s.queryWindowGen.value) return;
  s.bufferRows.value = r.rows;
  s.bufferOffset.value = offset;
  s.bufferRangeStart.value = offset;
  s.bufferRangeEnd.value = offset + r.rows.length;
  s.bufferQueryKey.value = qKey;
  s.windowTotal.value = r.total;
}

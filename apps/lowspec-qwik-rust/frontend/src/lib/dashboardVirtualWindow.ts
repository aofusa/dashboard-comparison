/**
 * ダッシュボード仮想テーブル用: 可視行数・スクロール→クエリオフセット・オーバースキャン。
 * P1: Worker への queryWindow 回数削減（前後バッファをまとめて取得し、ヒステリシスで再取得を抑制）。
 */

export const VIRT_ROW = 48;
export const VIRT_VIEW = 440;

/** 表示に使うデータ行数（ビューポート行 + わずかなマージン）。パディング計算と一致させる。 */
export const VISIBLE_DATA_ROW_COUNT =
  Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;

/**
 * クエリ時に先頭側へ広げる行数。小さなスクロールでは同じバッファ内で slice だけで済ませる。
 * Worker の limit 上限と合わせ過ぎないよう控えめに（指示書の 5〜15 の範囲）。
 */
export const OVER_SCAN = 10;

/** `handleQueryWindow` の LIMIT 上限と揃える */
export const QUERY_WINDOW_MAX = 500;

export function scrollStartRow(scrollTop: number): number {
  return Math.max(0, Math.floor(scrollTop / VIRT_ROW));
}

/**
 * 可視ウィンドウが必要とする行の排他的終端インデックス（0 .. total）。
 * 末尾では min(start+visibleCount, total) とし、ヒステリシスで total を超えて要求しない。
 */
export function visibleWindowNeedEnd(
  start: number,
  visibleCount: number,
  total: number,
): number {
  if (total <= 0) return 0;
  return Math.min(start + visibleCount, total);
}

/**
 * 同一 query キーかつバッファ [bufferRangeStart, bufferRangeEnd) が
 * [start, needEnd) を覆うとき、queryWindow を省略してよい。
 * total<=0 のときは偽（空表示の再取得を阻害しない）。
 */
export function hysteresisQueryWindowCanSkip(params: {
  sameQueryKey: boolean;
  start: number;
  visibleCount: number;
  total: number;
  bufferRangeStart: number;
  bufferRangeEnd: number;
}): boolean {
  const {
    sameQueryKey,
    start,
    visibleCount,
    total,
    bufferRangeStart,
    bufferRangeEnd,
  } = params;
  if (!sameQueryKey || total <= 0) return false;
  const needEnd = visibleWindowNeedEnd(start, visibleCount, total);
  return bufferRangeStart <= start && bufferRangeEnd >= needEnd;
}

/** フィルタ・ソートが同じキーか（ヒステリシス無効化用） */
export function queryWindowKey(
  filter: string,
  sortKey: string,
  sortAsc: boolean,
): string {
  return `${filter}\0${sortKey}\0${sortAsc}`;
}

/**
 * 可視範囲 [start, start + count) を覆うよう前後 OVER_SCAN して LIMIT/OFFSET を決める。
 */
export function computeQuerySpan(start: number): { offset: number; limit: number } {
  const count = VISIBLE_DATA_ROW_COUNT;
  const offset = Math.max(0, start - OVER_SCAN);
  const limit = Math.min(QUERY_WINDOW_MAX, count + 2 * OVER_SCAN);
  return { offset, limit };
}

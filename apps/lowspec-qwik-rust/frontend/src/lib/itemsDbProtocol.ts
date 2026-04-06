/** Worker ↔ メイン RPC（アイテム DuckDB SSOT） */

export const ITEMS_DB_SCHEMA_VERSION = "1";

export type ItemRow = {
  id: string;
  title: string;
  updated_at?: string | null;
};

export type ItemsStats = {
  total: number;
  by_initial: { letter: string; count: number }[];
};

export type SortKey = "id" | "title" | "updated_at";

export type InitPayload = {
  /** OPFS ファイル名用（JWT sub 等）。英数字に正規化推奨。 */
  namespace: string;
};

export type QueryWindowPayload = {
  filter: string;
  sortKey: SortKey;
  sortAsc: boolean;
  offset: number;
  limit: number;
};

export type QueryWindowResult = {
  rows: ItemRow[];
  total: number;
};

export type ApplyDeltaPayload = {
  upserts: ItemRow[];
  /** 指定 id をローカルから削除（サーバ itemIds 整合用は別メッセージでも可） */
  deleteIds?: string[];
};

export type ApplyMutationPayload =
  | { kind: "upsert"; row: ItemRow }
  | { kind: "delete"; id: string };

export type ReconcileIdsPayload = {
  ids: string[];
};

export type GetRowByIdPayload = {
  id: string;
};

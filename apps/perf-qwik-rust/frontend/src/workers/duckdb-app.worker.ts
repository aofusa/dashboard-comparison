/**
 * アイテム一覧の SSOT: DuckDB-WASM（OPFS 永続化、失敗時はインメモリ）。
 */
/// <reference lib="webworker" />

import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import {
  ITEMS_DB_SCHEMA_VERSION,
  type ApplyDeltaPayload,
  type ApplyMutationPayload,
  type InitPayload,
  type ItemRow,
  type ItemsStats,
  type QueryWindowPayload,
  type QueryWindowResult,
  type ReconcileIdsPayload,
  type SortKey,
} from "../lib/itemsDbProtocol";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdb_wasm,
    mainWorker: mvp_worker,
  },
  eh: {
    mainModule: duckdb_wasm_eh,
    mainWorker: eh_worker,
  },
};

let dbInst: duckdb.AsyncDuckDB | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let opfsSuffix = "default";

async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (dbInst) return dbInst;
  if (!initPromise) {
    initPromise = (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const w = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, w);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      dbInst = db;
      return db;
    })();
  }
  return initPromise;
}

async function ensureConn(): Promise<duckdb.AsyncDuckDBConnection> {
  const db = await getDb();
  if (!conn) {
    conn = await db.connect();
  }
  return conn;
}

async function flushIfPossible(): Promise<void> {
  const db = await getDb();
  try {
    await db.flushFiles();
  } catch {
    /* no-op */
  }
}

async function installSchema(c: duckdb.AsyncDuckDBConnection): Promise<void> {
  await c.query(`
    CREATE TABLE IF NOT EXISTS app_items (
      id VARCHAR PRIMARY KEY,
      title VARCHAR NOT NULL,
      updated_at VARCHAR
    );
    CREATE TABLE IF NOT EXISTS app_sync_meta (
      key VARCHAR PRIMARY KEY,
      value VARCHAR NOT NULL
    );
  `);
}

async function readMeta(
  c: duckdb.AsyncDuckDBConnection,
  key: string,
): Promise<string | null> {
  const t = await c.query(
    `SELECT value FROM app_sync_meta WHERE key = '${key.replace(/'/g, "''")}'`,
  );
  if (t.numRows === 0) return null;
  const col = t.getChild("value");
  const v = col?.get(0);
  return v == null ? null : String(v);
}

async function writeMeta(
  c: duckdb.AsyncDuckDBConnection,
  key: string,
  value: string,
): Promise<void> {
  const k = key.replace(/'/g, "''");
  const v = value.replace(/'/g, "''");
  await c.query(`
    INSERT OR REPLACE INTO app_sync_meta VALUES ('${k}', '${v}');
  `);
}

async function resetSchema(c: duckdb.AsyncDuckDBConnection): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS app_items;`);
  await c.query(`DELETE FROM app_sync_meta;`);
  await installSchema(c);
}

function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function arrowTableToRows(
  table: {
    numRows: number;
    schema: { fields: { name: string }[] };
    getChild: (name: string) => { get: (i: number) => unknown } | null;
  },
  maxRows: number,
): Record<string, string>[] {
  const columns = table.schema.fields.map((f) => f.name);
  const n = Math.min(maxRows, table.numRows);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, string> = {};
    for (const name of columns) {
      const col = table.getChild(name);
      const v = col?.get(i);
      row[name] = v == null ? "" : String(v);
    }
    rows.push(row);
  }
  return rows;
}

async function handleInit(payload: InitPayload): Promise<{ storage: string }> {
  opfsSuffix = (payload.namespace || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  const db = await getDb();
  let storage: "opfs" | "memory" = "memory";
  try {
    await db.open({
      path: `opfs://dashboard-items-${opfsSuffix}.duckdb`,
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      opfs: { fileHandling: "auto" },
    });
    storage = "opfs";
  } catch {
    try {
      await db.open({
        path: ":memory:",
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      });
    } catch {
      /* 既定（オープン省略時もインメモリで動作する環境がある） */
    }
  }
  if (conn) {
    await conn.close();
    conn = null;
  }
  const c = await ensureConn();
  await installSchema(c);
  const ver = await readMeta(c, "schema_version");
  if (ver !== ITEMS_DB_SCHEMA_VERSION) {
    await resetSchema(c);
    await writeMeta(c, "schema_version", ITEMS_DB_SCHEMA_VERSION);
    await flushIfPossible();
  }
  return { storage };
}

async function handleTruncateItems(): Promise<void> {
  const c = await ensureConn();
  await c.query(`DELETE FROM app_items`);
  await writeMeta(c, "max_updated_at", "");
  await flushIfPossible();
}

async function handleReplaceAllFromArrow(ipc: Uint8Array): Promise<void> {
  const c = await ensureConn();
  await c.query(`DROP TABLE IF EXISTS _import_arrow;`);
  await c.insertArrowFromIPCStream(ipc, {
    name: "_import_arrow",
    create: true,
  });
  await c.query(`DELETE FROM app_items;`);
  await c.query(`
    INSERT INTO app_items (id, title, updated_at)
    SELECT id, title, updated_at FROM _import_arrow;
  `);
  await c.query(`DROP TABLE _import_arrow;`);
  const maxU = await c.query(
    `SELECT COALESCE(MAX(updated_at), '') AS m FROM app_items`,
  );
  const mCol = maxU.getChild("m");
  const maxStr = mCol?.get(0) == null ? "" : String(mCol.get(0));
  await writeMeta(c, "max_updated_at", maxStr);
  await flushIfPossible();
}

async function handleApplyDelta(p: ApplyDeltaPayload): Promise<void> {
  const c = await ensureConn();
  if (p.upserts?.length) {
    const stmt = await c.prepare(
      `INSERT OR REPLACE INTO app_items (id, title, updated_at) VALUES (?, ?, ?)`,
    );
    try {
      for (const r of p.upserts) {
        await stmt.query(
          r.id,
          r.title,
          r.updated_at == null || r.updated_at === "" ? "" : r.updated_at,
        );
      }
    } finally {
      await stmt.close();
    }
  }
  if (p.deleteIds?.length) {
    for (const id of p.deleteIds) {
      const esc = id.replace(/'/g, "''");
      await c.query(`DELETE FROM app_items WHERE id = '${esc}'`);
    }
  }
  const maxU = await c.query(
    `SELECT COALESCE(MAX(updated_at), '') AS m FROM app_items`,
  );
  const mCol = maxU.getChild("m");
  const maxStr = mCol?.get(0) == null ? "" : String(mCol.get(0));
  await writeMeta(c, "max_updated_at", maxStr);
  await flushIfPossible();
}

async function handleApplyMutation(p: ApplyMutationPayload): Promise<void> {
  const c = await ensureConn();
  if (p.kind === "delete") {
    const esc = p.id.replace(/'/g, "''");
    await c.query(`DELETE FROM app_items WHERE id = '${esc}'`);
  } else {
    const stmt = await c.prepare(
      `INSERT OR REPLACE INTO app_items (id, title, updated_at) VALUES (?, ?, ?)`,
    );
    try {
      await stmt.query(
        p.row.id,
        p.row.title,
        p.row.updated_at == null || p.row.updated_at === ""
          ? ""
          : p.row.updated_at,
      );
    } finally {
      await stmt.close();
    }
  }
  const maxU = await c.query(
    `SELECT COALESCE(MAX(updated_at), '') AS m FROM app_items`,
  );
  const mCol = maxU.getChild("m");
  const maxStr = mCol?.get(0) == null ? "" : String(mCol.get(0));
  await writeMeta(c, "max_updated_at", maxStr);
  await flushIfPossible();
}

async function handleReconcileIds(p: ReconcileIdsPayload): Promise<void> {
  const c = await ensureConn();
  if (p.ids.length === 0) {
    await c.query(`DELETE FROM app_items`);
  } else {
    await c.query(`DROP TABLE IF EXISTS _srv_ids`);
    await c.query(`CREATE TEMP TABLE _srv_ids (id VARCHAR PRIMARY KEY);`);
    const CHUNK = 500;
    for (let i = 0; i < p.ids.length; i += CHUNK) {
      const chunk = p.ids.slice(i, i + CHUNK);
      const vals = chunk.map((id) => `('${id.replace(/'/g, "''")}')`).join(",");
      await c.query(`INSERT OR IGNORE INTO _srv_ids VALUES ${vals}`);
    }
    await c.query(
      `DELETE FROM app_items WHERE id NOT IN (SELECT id FROM _srv_ids)`,
    );
    await c.query(`DROP TABLE IF EXISTS _srv_ids`);
  }
  const maxU = await c.query(
    `SELECT COALESCE(MAX(updated_at), '') AS m FROM app_items`,
  );
  const mCol = maxU.getChild("m");
  const maxStr = mCol?.get(0) == null ? "" : String(mCol.get(0));
  await writeMeta(c, "max_updated_at", maxStr);
  await flushIfPossible();
}

async function handleQueryWindow(
  p: QueryWindowPayload,
): Promise<QueryWindowResult> {
  const c = await ensureConn();
  const lim = Math.max(0, Math.min(500, Math.floor(p.limit)));
  const off = Math.max(0, Math.floor(p.offset));
  const sortKey: SortKey = p.sortKey;
  const orderCol =
    sortKey === "id" ? "id" : sortKey === "updated_at" ? "updated_at" : "title";
  const dir = p.sortAsc ? "ASC" : "DESC";

  let countTbl;
  let dataTbl;
  const ft = p.filter.trim();
  if (!ft) {
    countTbl = await c.query(`SELECT COUNT(*)::BIGINT AS c FROM app_items`);
    dataTbl = await c.query(`
      SELECT id, title, updated_at FROM app_items
      ORDER BY ${orderCol} ${dir}
      LIMIT ${lim} OFFSET ${off}
    `);
  } else {
    const esc = escapeLikePattern(ft);
    const stmtCount = await c.prepare(
      `SELECT COUNT(*)::BIGINT AS c FROM app_items WHERE title ILIKE ?`,
    );
    const stmtData = await c.prepare(
      `SELECT id, title, updated_at FROM app_items WHERE title ILIKE ? ORDER BY ${orderCol} ${dir} LIMIT ${lim} OFFSET ${off}`,
    );
    try {
      countTbl = await stmtCount.query(`%${esc}%`);
      dataTbl = await stmtData.query(`%${esc}%`);
    } finally {
      await stmtCount.close();
      await stmtData.close();
    }
  }

  const countCol = countTbl.getChild("c");
  const total = Number(countCol?.get(0) ?? 0);
  const rows: ItemRow[] = [];
  const idCol = dataTbl.getChild("id");
  const titleCol = dataTbl.getChild("title");
  const updCol = dataTbl.getChild("updated_at");
  for (let i = 0; i < dataTbl.numRows; i++) {
    rows.push({
      id: String(idCol?.get(i) ?? ""),
      title: String(titleCol?.get(i) ?? ""),
      updated_at:
        updCol?.get(i) == null || updCol?.get(i) === ""
          ? null
          : String(updCol.get(i)),
    });
  }
  return { rows, total };
}

async function handleQueryStats(): Promise<ItemsStats> {
  const c = await ensureConn();
  const totalTbl = await c.query(`SELECT COUNT(*)::BIGINT AS c FROM app_items`);
  const cCol = totalTbl.getChild("c");
  const total = Number(cCol?.get(0) ?? 0);
  const byTbl = await c.query(`
    SELECT
      CASE
        WHEN title IS NULL OR title = '' THEN ''
        ELSE substr(title, 1, 1)
      END AS letter,
      COUNT(*)::BIGINT AS cnt
    FROM app_items
    GROUP BY 1
    ORDER BY 1
  `);
  const lCol = byTbl.getChild("letter");
  const nCol = byTbl.getChild("cnt");
  const by_initial: { letter: string; count: number }[] = [];
  for (let i = 0; i < byTbl.numRows; i++) {
    by_initial.push({
      letter: String(lCol?.get(i) ?? ""),
      count: Number(nCol?.get(i) ?? 0),
    });
  }
  return { total, by_initial };
}

async function handleGetMaxUpdatedAt(): Promise<string> {
  const c = await ensureConn();
  const m = await readMeta(c, "max_updated_at");
  if (m != null && m !== "") return m;
  const t = await c.query(
    `SELECT COALESCE(MAX(updated_at), '') AS m FROM app_items`,
  );
  const col = t.getChild("m");
  return col?.get(0) == null ? "" : String(col.get(0));
}

async function handleRowCount(): Promise<number> {
  const c = await ensureConn();
  const t = await c.query(`SELECT COUNT(*)::BIGINT AS c FROM app_items`);
  const col = t.getChild("c");
  return Number(col?.get(0) ?? 0);
}

async function handleGetRowById(id: string): Promise<ItemRow | null> {
  const c = await ensureConn();
  const esc = id.replace(/'/g, "''");
  const t = await c.query(
    `SELECT id, title, updated_at FROM app_items WHERE id = '${esc}' LIMIT 1`,
  );
  if (t.numRows === 0) return null;
  const idCol = t.getChild("id");
  const titleCol = t.getChild("title");
  const updCol = t.getChild("updated_at");
  return {
    id: String(idCol?.get(0) ?? ""),
    title: String(titleCol?.get(0) ?? ""),
    updated_at:
      updCol?.get(0) == null || updCol?.get(0) === ""
        ? null
        : String(updCol.get(0)),
  };
}

/** 旧スモーク: 一時テーブルで Arrow を検証（デバッグ用） */
async function handleSmokeQuery(ipc: Uint8Array): Promise<{
  version: string;
  countSql: string;
  countRows: Record<string, string>[];
  sampleSql: string;
  sampleRows: Record<string, string>[];
}> {
  const c = await ensureConn();
  await c.query(`DROP TABLE IF EXISTS _smoke_staging`);
  await c.insertArrowFromIPCStream(ipc, {
    name: "_smoke_staging",
    create: true,
  });
  const verTbl = await c.query(`SELECT version() AS v`);
  const version = arrowTableToRows(verTbl, 1)[0]?.v ?? "";
  const countSql = `SELECT COUNT(*)::BIGINT AS cnt FROM _smoke_staging`;
  const countTbl = await c.query(countSql);
  const countRows = arrowTableToRows(countTbl, 1);
  const sampleSql = `SELECT * FROM _smoke_staging ORDER BY title LIMIT 8`;
  const sampleTbl = await c.query(sampleSql);
  const sampleRows = arrowTableToRows(sampleTbl, 8);
  await c.query(`DROP TABLE IF EXISTS _smoke_staging`);
  return { version, countSql, countRows, sampleSql, sampleRows };
}

type Req =
  | { id: number; type: "init"; payload: InitPayload }
  | { id: number; type: "replaceAllFromArrow"; ipc: ArrayBuffer }
  | { id: number; type: "applyDelta"; payload: ApplyDeltaPayload }
  | { id: number; type: "applyMutation"; payload: ApplyMutationPayload }
  | { id: number; type: "reconcileIds"; payload: ReconcileIdsPayload }
  | { id: number; type: "queryWindow"; payload: QueryWindowPayload }
  | { id: number; type: "queryStats" }
  | { id: number; type: "getMaxUpdatedAt" }
  | { id: number; type: "rowCount" }
  | { id: number; type: "getRowById"; payload: { id: string } }
  | { id: number; type: "truncateItems" }
  | { id: number; type: "smokeQuery"; ipc: ArrayBuffer };

declare const self: DedicatedWorkerGlobalScope;

const queue: Req[] = [];
let draining = false;

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.length) {
      const msg = queue.shift()!;
      try {
        let result: unknown;
        switch (msg.type) {
          case "init":
            result = await handleInit(msg.payload);
            break;
          case "replaceAllFromArrow":
            await handleReplaceAllFromArrow(new Uint8Array(msg.ipc));
            result = undefined;
            break;
          case "applyDelta":
            await handleApplyDelta(msg.payload);
            result = undefined;
            break;
          case "applyMutation":
            await handleApplyMutation(msg.payload);
            result = undefined;
            break;
          case "reconcileIds":
            await handleReconcileIds(msg.payload);
            result = undefined;
            break;
          case "queryWindow":
            result = await handleQueryWindow(msg.payload);
            break;
          case "queryStats":
            result = await handleQueryStats();
            break;
          case "getMaxUpdatedAt":
            result = await handleGetMaxUpdatedAt();
            break;
          case "rowCount":
            result = await handleRowCount();
            break;
          case "getRowById":
            result = await handleGetRowById(msg.payload.id);
            break;
          case "truncateItems":
            await handleTruncateItems();
            result = undefined;
            break;
          case "smokeQuery":
            result = await handleSmokeQuery(new Uint8Array(msg.ipc));
            break;
          default:
            throw new Error("unknown type");
        }
        self.postMessage({ id: msg.id, ok: true, result });
      } catch (e) {
        self.postMessage({
          id: msg.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    draining = false;
  }
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const data = ev.data;
  if (data == null || typeof data.id !== "number" || !data.type) return;
  queue.push(data);
  if (!draining) void drain();
};

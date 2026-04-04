/**
 * DuckDB-WASM をメインスレッドから切り離す専用 Worker（改修案 P3a）。
 */
/// <reference lib="webworker" />

import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

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

let dbSingleton: duckdb.AsyncDuckDB | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function getDuckDb(): Promise<duckdb.AsyncDuckDB> {
  if (dbSingleton) return dbSingleton;
  if (!initPromise) {
    initPromise = (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      dbSingleton = db;
      return db;
    })();
  }
  return initPromise;
}

function arrowTableToRows(
  table: {
    numRows: number;
    schema: { fields: { name: string }[] };
    getChild: (name: string) => { get: (i: number) => unknown } | null;
  },
  maxRows: number,
): { columns: string[]; rows: Record<string, string>[] } {
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
  return { columns, rows };
}

const STAGING = "api_items_ipc";

type SmokeResult = {
  version: string;
  countSql: string;
  countRows: Record<string, string>[];
  sampleSql: string;
  sampleRows: Record<string, string>[];
};

async function runSmoke(ipcStream: Uint8Array): Promise<SmokeResult> {
  const db = await getDuckDb();
  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ${STAGING}`);
    await conn.insertArrowFromIPCStream(ipcStream, {
      name: STAGING,
      create: true,
    });

    const verTbl = await conn.query(`SELECT version() AS v`);
    const { rows: vrows } = arrowTableToRows(verTbl, 1);
    const version = vrows[0]?.v ?? "";

    const countSql = `SELECT COUNT(*)::BIGINT AS cnt FROM ${STAGING}`;
    const countTbl = await conn.query(countSql);
    const { rows: countRows } = arrowTableToRows(countTbl, 1);

    const sampleSql = `SELECT * FROM ${STAGING} ORDER BY title LIMIT 8`;
    const sampleTbl = await conn.query(sampleSql);
    const { rows: sampleRows } = arrowTableToRows(sampleTbl, 8);

    return {
      version,
      countSql,
      countRows,
      sampleSql,
      sampleRows,
    };
  } finally {
    await conn.close();
  }
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (ev: MessageEvent) => {
  if (ev.data?.type !== "duckdb-query") return;
  try {
    const raw = ev.data.ipc as ArrayBuffer;
    const ipc = new Uint8Array(raw);
    const payload = await runSmoke(ipc);
    self.postMessage({ type: "duckdb-result", payload });
  } catch (e) {
    self.postMessage({
      type: "duckdb-error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};

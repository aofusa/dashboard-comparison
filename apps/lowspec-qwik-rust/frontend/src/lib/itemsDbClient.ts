import type {
  ApplyDeltaPayload,
  ApplyMutationPayload,
  InitPayload,
  ItemRow,
  ItemsStats,
  QueryWindowPayload,
  QueryWindowResult,
  ReconcileIdsPayload,
} from "./itemsDbProtocol";

type RpcResult<T> = { ok: true; result: T } | { ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/duckdb-app.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (ev: MessageEvent<RpcResult<unknown> & { id: number }>) => {
      const d = ev.data;
      if (d == null || typeof d.id !== "number") return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error));
    };
  }
  return worker;
}

function rpc<T>(msg: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    w.postMessage({ id, ...msg });
  });
}

export async function itemsDbInit(payload: InitPayload): Promise<{
  storage: string;
}> {
  return rpc({ type: "init", payload });
}

export async function itemsDbReplaceAllFromArrow(ipc: Uint8Array): Promise<void> {
  const w = ensureWorker();
  const id = nextId++;
  const buf = ipc.buffer.slice(ipc.byteOffset, ipc.byteOffset + ipc.byteLength);
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: () => resolve(),
      reject,
    });
    w.postMessage({ id, type: "replaceAllFromArrow", ipc: buf }, [buf]);
  });
}

export async function itemsDbApplyDelta(payload: ApplyDeltaPayload): Promise<void> {
  return rpc({ type: "applyDelta", payload });
}

export async function itemsDbApplyMutation(
  payload: ApplyMutationPayload,
): Promise<void> {
  return rpc({ type: "applyMutation", payload });
}

export async function itemsDbReconcileIds(
  payload: ReconcileIdsPayload,
): Promise<void> {
  return rpc({ type: "reconcileIds", payload });
}

export async function itemsDbQueryWindow(
  payload: QueryWindowPayload,
): Promise<QueryWindowResult> {
  return rpc({ type: "queryWindow", payload });
}

export async function itemsDbQueryStats(): Promise<ItemsStats> {
  return rpc({ type: "queryStats" });
}

export async function itemsDbGetMaxUpdatedAt(): Promise<string> {
  return rpc({ type: "getMaxUpdatedAt" });
}

export async function itemsDbRowCount(): Promise<number> {
  return rpc({ type: "rowCount" });
}

/** 仮想ウィンドウ外の行でも SSOT からタイトルを取得する（モーダル用） */
export async function itemsDbGetRowById(id: string): Promise<ItemRow | null> {
  return rpc({ type: "getRowById", payload: { id } });
}

export async function itemsDbTruncate(): Promise<void> {
  return rpc({ type: "truncateItems" });
}

export type DuckdbSmokeResult = {
  version: string;
  countSql: string;
  countRows: Record<string, string>[];
  sampleSql: string;
  sampleRows: Record<string, string>[];
};

export async function itemsDbSmokeQuery(ipc: Uint8Array): Promise<DuckdbSmokeResult> {
  const w = ensureWorker();
  const id = nextId++;
  const buf = ipc.buffer.slice(ipc.byteOffset, ipc.byteOffset + ipc.byteLength);
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as DuckdbSmokeResult),
      reject,
    });
    w.postMessage({ id, type: "smokeQuery", ipc: buf }, [buf]);
  });
}

/** JWT payload の sub（検証なし）。永続 DB の名前空間用。 */
export function namespaceFromAccessToken(token: string | null): string {
  if (!token) return "anon";
  try {
    const p = token.split(".")[1];
    if (!p) return "anon";
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const json = JSON.parse(atob(b64 + "=".repeat(pad))) as {
      sub?: string;
    };
    return typeof json.sub === "string" && json.sub.length > 0
      ? json.sub
      : "anon";
  } catch {
    return "anon";
  }
}

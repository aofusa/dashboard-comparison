export type DuckdbArrowSmokeResult = {
  version: string;
  countSql: string;
  countRows: Record<string, string>[];
  sampleSql: string;
  sampleRows: Record<string, string>[];
};

let worker: Worker | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/duckdb-app.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return worker;
}

/**
 * 専用 Worker 上で DuckDB-WASM を実行（メインはメッセージのみ）。
 * `ipc` のバッファはコピーして送る（元の Uint8Array はそのまま使える）。
 */
export async function queryArrowIpcSmoke(
  ipc: Uint8Array,
): Promise<DuckdbArrowSmokeResult> {
  const w = ensureWorker();
  const buf = ipc.buffer.slice(ipc.byteOffset, ipc.byteOffset + ipc.byteLength);
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "duckdb-result") {
        w.removeEventListener("message", onMessage);
        resolve(ev.data.payload as DuckdbArrowSmokeResult);
      } else if (ev.data?.type === "duckdb-error") {
        w.removeEventListener("message", onMessage);
        reject(new Error(ev.data.message as string));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "duckdb-query", ipc: buf }, [buf]);
  });
}

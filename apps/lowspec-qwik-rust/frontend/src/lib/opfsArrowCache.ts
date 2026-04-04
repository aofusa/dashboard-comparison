/** 改修案 P3c: 展開済み Arrow IPC を OPFS に保存（再読込の補助。未対応環境は no-op）。 */

const FILE = "lowspec-items-arrow-ipc.bin";

export async function tryWriteArrowIpcToOpfs(data: Uint8Array): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  } catch {
    /* OPFS 不可時は無視 */
  }
}

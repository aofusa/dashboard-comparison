import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * [ENV-01] Qwik Vite dev の HTML 応答には server.headers が乗らない場合がある（curl 確認済み）。
 * 意図した COI 設定がリポジトリに存在することを静的に検証する。
 */
describe("[ENV-01] vite COI headers in config", () => {
  it("[ENV-01] vite.config sets COOP and COEP on server and preview", () => {
    const vitePath = path.join(root, "../../vite.config.ts");
    const src = readFileSync(vitePath, "utf-8");
    expect(src).toContain("Cross-Origin-Opener-Policy");
    expect(src).toContain("same-origin");
    expect(src).toContain("Cross-Origin-Embedder-Policy");
    expect(src).toContain("require-corp");
  });
});

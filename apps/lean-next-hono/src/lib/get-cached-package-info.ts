import { readFile } from "fs/promises";
import { join } from "path";
import { unstable_cache } from "next/cache";

export type CachedPackageInfo = { name: string; version: string };

/**
 * 仕様 v4.1.1 の `unstable_cache` 利用例（package.json をサーバーで読み、タグ付きキャッシュ）。
 */
export const getCachedPackageInfo = unstable_cache(
  async (): Promise<CachedPackageInfo> => {
    const raw = await readFile(join(process.cwd(), "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { name: string; version: string };
    return { name: pkg.name, version: pkg.version };
  },
  ["lean-package-info"],
  { revalidate: 3600, tags: ["package"] },
);

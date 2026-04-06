import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as setup } from "@playwright/test";
import { waitForAppTableReady } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(here, ".auth", "dev.json");

/**
 * 一度だけログインし storageState を書き出す。
 * `chromium-auth` プロジェクトが依存し、認証済みテストで AuthLogin の多重実行を避ける。
 */
setup("authenticate dev", async ({ page }) => {
  await page.goto("/login/");
  await page.getByLabel("メール").fill("dev@example.com");
  await page.getByLabel("パスワード").fill("devpass");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/app\/?/, { timeout: 60_000 });
  await waitForAppTableReady(page);
  await page.context().storageState({ path: authFile });
});

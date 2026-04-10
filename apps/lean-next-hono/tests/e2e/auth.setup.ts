import { test as setup } from "@playwright/test";

import { waitForDashboardReady } from "./helpers";

const authFile = process.env.PW_E2E_AUTH_FILE;
if (!authFile) {
  throw new Error("PW_E2E_AUTH_FILE が未設定です（playwright.config.js を経由して実行してください）");
}

/**
 * 一度だけログインし storageState を書き出す（Cookie + localStorage）。
 * chromium-auth が依存し、認証済みシナリオの多重ログインを避ける。
 */
setup("authenticate dev", async ({ page }) => {
  const csrfWait = page.waitForResponse(
    (res) => res.url().includes("/api/auth/csrf") && res.ok(),
    { timeout: 60_000 },
  );
  await page.goto("/login");
  await csrfWait;
  await page.getByLabel("メール").fill("dev@example.com");
  await page.getByLabel("パスワード").fill("devpass");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/app\/?/, { timeout: 60_000 });
  await waitForDashboardReady(page);
  await page.context().storageState({ path: authFile });
});

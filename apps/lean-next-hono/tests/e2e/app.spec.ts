import { expect, test } from "@playwright/test";
import {
  fetchAllItemTitlesViaRest,
  itemRowByTitle,
  LEAN_ACCESS_TOKEN_KEY,
  narrowItemsByFilter,
  waitForDashboardReady,
  waitForItemsDelete,
  waitForItemsPost,
  waitForItemsPut,
} from "./helpers";

test.describe("[ENV-01] dev server reachability", () => {
  test("[ENV-01] /login responds OK", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL ?? ""}/login`);
    expect(res.ok()).toBeTruthy();
  });
});

test.describe("[RT-02] unauthenticated /app", () => {
  test("[RT-02] redirects to login when no session cookie", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
    // ログイン見出しは CardTitle（div）のため role=heading ではない
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: "ログイン" }),
    ).toBeVisible();
    await expect(page.getByLabel("メール")).toBeVisible();
  });
});

test.describe("authenticated dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await waitForDashboardReady(page);
  });

  test("[RT-01][AUTH-01] reach /app with ダッシュボード heading", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "ダッシュボード", level: 1 }),
    ).toBeVisible();
  });

  test("[UI-01][UI-04] description, 新規作成, no サーバから再同期", async ({
    page,
  }) => {
    await expect(page.getByText(/GraphQL/)).toBeVisible();
    await expect(page.getByText(/DuckDB/)).toBeVisible();
    await expect(page.getByRole("button", { name: "新規作成" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "サーバから再同期" }),
    ).toHaveCount(0);
  });

  test("[UI-03] dashboard shell stabilizes after load", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "ダッシュボード", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("#filter")).toBeVisible();
    await expect(page.getByText(/仮想スクロール/)).toBeVisible({
      timeout: 120_000,
    });
  });

  test("[CRUD-01] create item shows in list", async ({ page }) => {
    const title = `e2e-${Date.now()}`;
    await page.getByRole("button", { name: "新規作成" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("アイテムを作成")).toBeVisible();
    await dialog.getByLabel("タイトル").fill(title);
    const postWait = waitForItemsPost(page);
    await dialog.getByRole("button", { name: "作成" }).click();
    const postRes = await postWait;
    expect(postRes.status()).toBe(201);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, title);
    await expect(page.getByText(title, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("[SRV-01] after create and reload, REST list contains title", async ({
    page,
    request,
  }) => {
    const title = `e2e-api-${Date.now()}`;
    await page.getByRole("button", { name: "新規作成" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(title);
    const postWait = waitForItemsPost(page);
    await dialog.getByRole("button", { name: "作成" }).click();
    expect((await postWait).status()).toBe(201);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, title);
    await expect(page.getByText(title, { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await waitForDashboardReady(page);

    const token = await page.evaluate((key) => localStorage.getItem(key), LEAN_ACCESS_TOKEN_KEY);
    expect(token).toBeTruthy();
    const origin = new URL(page.url()).origin;
    const titles = await fetchAllItemTitlesViaRest(request, origin, token!);
    expect(titles).toContain(title);
  });
});

test.describe.serial("[CRUD-02][CRUD-03] edit twice and delete", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await waitForDashboardReady(page);
  });

  test("[CRUD-02] edit same row twice", async ({ page }) => {
    const base = `e2e-edit-${Date.now()}`;
    await page.getByRole("button", { name: "新規作成" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(base);
    const c1 = waitForItemsPost(page);
    await dialog.getByRole("button", { name: "作成" }).click();
    expect((await c1).status()).toBe(201);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, base);
    const row = itemRowByTitle(page, base).first();
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "編集" }).click();
    const editDlg = page.getByRole("dialog");
    await expect(editDlg.getByText("アイテムを更新")).toBeVisible();
    await editDlg.getByLabel("タイトル").fill(`${base}-v2`);
    const u1 = waitForItemsPut(page);
    await editDlg.getByRole("button", { name: "保存" }).click();
    expect((await u1).status()).toBe(200);
    await expect(editDlg).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, `${base}-v2`);
    await expect(
      page.getByText(`${base}-v2`, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const row2 = itemRowByTitle(page, `${base}-v2`).first();
    await row2.getByRole("button", { name: "編集" }).click();
    const editDlg2 = page.getByRole("dialog");
    await editDlg2.getByLabel("タイトル").fill(`${base}-v3`);
    const u2 = waitForItemsPut(page);
    await editDlg2.getByRole("button", { name: "保存" }).click();
    expect((await u2).status()).toBe(200);
    await expect(editDlg2).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, `${base}-v3`);
    await expect(
      page.getByText(`${base}-v3`, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("[CRUD-03] delete removes row", async ({ page }) => {
    const base = `e2e-del-${Date.now()}`;
    await page.getByRole("button", { name: "新規作成" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(base);
    const c = waitForItemsPost(page);
    await dialog.getByRole("button", { name: "作成" }).click();
    expect((await c).status()).toBe(201);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, base);
    const row = itemRowByTitle(page, base).first();
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "削除" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("削除の確認")).toBeVisible();
    const delWait = waitForItemsDelete(page);
    await confirm.getByRole("button", { name: "削除する" }).click();
    expect((await delWait).status()).toBe(204);
    await expect(confirm).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(base, { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });
  });
});

test.describe("sync and filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await waitForDashboardReady(page);
  });

  test("[UI-02] filter and sort buttons keep dashboard usable", async ({
    page,
  }) => {
    const a = `e2e-sort-a-${Date.now()}`;
    const b = `e2e-sort-b-${Date.now()}`;
    for (const t of [a, b]) {
      await page.getByRole("button", { name: "新規作成" }).click();
      const d = page.getByRole("dialog");
      await d.getByLabel("タイトル").fill(t);
      const w = waitForItemsPost(page);
      await d.getByRole("button", { name: "作成" }).click();
      expect((await w).status()).toBe(201);
      await expect(d).toBeHidden({ timeout: 60_000 });
    }
    await narrowItemsByFilter(page, a);
    await expect(page.getByText(a, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.locator("#filter").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("e2e-sort", { delay: 8 });
    await expect(page.getByText(a, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "タイトル" }).click();
    await page.getByRole("button", { name: /昇順|降順/ }).click();
    await expect(
      page.getByRole("heading", { name: "ダッシュボード", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/仮想スクロール/)).toBeVisible();
  });

  test("[SYNC-03] reload keeps dashboard usable", async ({ page }) => {
    await page.reload();
    await waitForDashboardReady(page);
    await expect(
      page.getByRole("heading", { name: "ダッシュボード", level: 1 }),
    ).toBeVisible();
  });
});

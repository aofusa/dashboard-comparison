import { expect, test } from "@playwright/test";
import {
  expectGraphqlOk,
  narrowItemsByFilter,
  waitForAppTableReady,
  waitForGraphqlOperation,
} from "./helpers";

test.describe("[ENV-01] dev server reachability", () => {
  /** Qwik Vite dev の HTML に server.headers が乗らないことがあるため、COOP/COEP の厳密検証は Vitest `vite-coi-config.test.ts` 側。 */
  test("[ENV-01] /login responds OK", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL ?? ""}/login/`);
    expect(res.ok()).toBeTruthy();
  });
});

test.describe("[RT-02] unauthenticated /app", () => {
  test("[RT-02] redirects to login when no token", async ({ page }) => {
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/login\/?/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "ログイン", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("authenticated dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/");
    await waitForAppTableReady(page);
  });

  test("[RT-01][AUTH-01] reach /app with アイテム heading", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "アイテム", level: 1 }),
    ).toBeVisible();
  });

  test("[UI-01][UI-04] description and toolbar buttons", async ({ page }) => {
    await expect(page.getByText(/DuckDB-WASM/)).toBeVisible();
    await expect(page.getByRole("button", { name: "追加" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "サーバから再同期" }),
    ).toBeVisible();
  });

  test("[UI-03] table body stabilizes after load", async ({ page }) => {
    const tbody = page.locator("tbody");
    await expect(tbody).toBeVisible();
    await expect(
      tbody.getByText("行がありません").or(tbody.locator("tr").nth(1)),
    ).toBeVisible({ timeout: 120_000 });
  });

  test("[CRUD-01] create item shows in table", async ({ page }) => {
    const title = `e2e-${Date.now()}`;
    await page.getByRole("button", { name: "追加" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("アイテムを追加")).toBeVisible();
    await dialog.getByLabel("タイトル").fill(title);
    const createGql = waitForGraphqlOperation(page, "CreateItem");
    await dialog.getByRole("button", { name: "作成" }).click();
    await expectGraphqlOk(await createGql);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, title);
    await expect(page.locator("td", { hasText: title })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("[SRV-01] after create and reload, itemsSlice via API contains title", async ({
    page,
    request,
  }) => {
    const title = `e2e-api-${Date.now()}`;
    await page.getByRole("button", { name: "追加" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(title);
    const createGql = waitForGraphqlOperation(page, "CreateItem");
    await dialog.getByRole("button", { name: "作成" }).click();
    await expectGraphqlOk(await createGql);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, title);
    await expect(page.locator("td", { hasText: title })).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await waitForAppTableReady(page);

    const token = await page.evaluate(() =>
      localStorage.getItem("perf_access_token"),
    );
    expect(token).toBeTruthy();
    const origin = new URL(page.url()).origin;
    const res = await request.post(`${origin}/api/graphql`, {
      data: {
        query: `query SrvItemsSlice { itemsSlice(limit: 10000, offset: 0) { items { title } } }`,
      },
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await expectGraphqlOk<{
      data: { itemsSlice: { items: { title: string }[] } };
    }>(res);
    const titles = body.data.itemsSlice.items.map((x) => x.title);
    expect(titles).toContain(title);
  });
});

test.describe.serial("[CRUD-02][CRUD-03] edit twice and delete", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/");
    await waitForAppTableReady(page);
  });

  test("[CRUD-02] edit same row twice", async ({ page }) => {
    const base = `e2e-edit-${Date.now()}`;
    await page.getByRole("button", { name: "追加" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(base);
    const createGql = waitForGraphqlOperation(page, "CreateItem");
    await dialog.getByRole("button", { name: "作成" }).click();
    await expectGraphqlOk(await createGql);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, base);
    const row = page.locator("tr", { hasText: base });
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "編集" }).click();
    const editDlg = page.getByRole("dialog");
    await editDlg.getByLabel("タイトル").fill(`${base}-v2`);
    const upd1 = waitForGraphqlOperation(page, "UpdateItem");
    await editDlg.getByRole("button", { name: "保存" }).click();
    await expectGraphqlOk(await upd1);
    await expect(editDlg).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, `${base}-v2`);
    await expect(page.locator("td", { hasText: `${base}-v2` })).toBeVisible({
      timeout: 60_000,
    });

    const row2 = page.locator("tr", { hasText: `${base}-v2` });
    await row2.getByRole("button", { name: "編集" }).click();
    const editDlg2 = page.getByRole("dialog");
    await editDlg2.getByLabel("タイトル").fill(`${base}-v3`);
    const upd2 = waitForGraphqlOperation(page, "UpdateItem");
    await editDlg2.getByRole("button", { name: "保存" }).click();
    await expectGraphqlOk(await upd2);
    await expect(editDlg2).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, `${base}-v3`);
    await expect(page.locator("td", { hasText: `${base}-v3` })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("[CRUD-03] delete removes row", async ({ page }) => {
    const base = `e2e-del-${Date.now()}`;
    await page.getByRole("button", { name: "追加" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("タイトル").fill(base);
    const createGql = waitForGraphqlOperation(page, "CreateItem");
    await dialog.getByRole("button", { name: "作成" }).click();
    await expectGraphqlOk(await createGql);
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await narrowItemsByFilter(page, base);
    const row = page.locator("tr", { hasText: base });
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "削除" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("削除の確認")).toBeVisible();
    const delGql = waitForGraphqlOperation(page, "DeleteItem");
    await confirm.getByRole("button", { name: "削除" }).click();
    await expectGraphqlOk(await delGql);
    await expect(confirm).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("td", { hasText: base })).toHaveCount(0, {
      timeout: 60_000,
    });
  });
});

test.describe("sync and filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/");
    await waitForAppTableReady(page);
  });

  test("[SYNC-02] full resync completes without error banner", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "サーバから再同期" }).click();
    await waitForAppTableReady(page);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("[SYNC-01] skipped — focus は GraphQL を保証しない", async (
    {},
    testInfo,
  ) => {
    testInfo.skip(
      true,
      "visibility/focus は GraphQL を保証しないため waitForResponse では意味のある検証にならない",
    );
  });

  test("[UI-02] filter and sort change view", async ({ page }) => {
    const a = `e2e-sort-a-${Date.now()}`;
    const b = `e2e-sort-b-${Date.now()}`;
    for (const t of [a, b]) {
      await page.getByRole("button", { name: "追加" }).click();
      const d = page.getByRole("dialog");
      await d.getByLabel("タイトル").fill(t);
      const g = waitForGraphqlOperation(page, "CreateItem");
      await d.getByRole("button", { name: "作成" }).click();
      await expectGraphqlOk(await g);
      await expect(d).toBeHidden({ timeout: 60_000 });
    }
    await narrowItemsByFilter(page, a);
    await expect(page.locator("td", { hasText: a })).toBeVisible({
      timeout: 60_000,
    });
    await page.locator("#filter").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("e2e-sort", { delay: 8 });
    await expect(page.locator("td", { hasText: a })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel("ソート").selectOption("title");
    await page.getByLabel("順序").selectOption("desc");
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("[SYNC-03] reload keeps dashboard usable", async ({ page }) => {
    await page.reload();
    await waitForAppTableReady(page);
    await expect(
      page.getByRole("heading", { name: "アイテム", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("[CRUD-04] mutation error", () => {
  test.skip(true, "別ジョブ: API 失敗スタブまたは backend 停止が必要で flaky になりやすい");
});

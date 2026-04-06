import { expect, type Page, type Response } from "@playwright/test";

/** Mutation / Query の POST を待ち、HTTP 200 かつ GraphQL `errors` が空であることを検証し、JSON を返す */
export async function expectGraphqlOk<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  expect(res.ok(), `HTTP ${res.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  const json = JSON.parse(text) as T & { errors?: unknown[] };
  const errs = json.errors;
  expect(
    errs == null || (Array.isArray(errs) && errs.length === 0),
    errs && Array.isArray(errs) ? JSON.stringify(errs) : String(errs),
  ).toBeTruthy();
  return json as T;
}

/** `postData` の `operationName` で一致（`createItem` 部分一致だと誤マッチしうる） */
export function waitForGraphqlOperation(page: Page, operationName: string) {
  return page.waitForResponse(
    async (res) => {
      if (res.request().method() !== "POST") return false;
      if (!res.url().includes("/api/graphql")) return false;
      const data = res.request().postData();
      if (data == null) return false;
      try {
        const j = JSON.parse(data) as { operationName?: string };
        return j.operationName === operationName;
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  );
}

/** DuckDB WASM 初期化後、集計バー（総件数）が出るまで待つ */
export async function waitForAppTableReady(page: Page) {
  await expect(
    page.getByRole("heading", { name: "アイテム", level: 1 }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("table")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/総件数/)).toBeVisible({ timeout: 120_000 });
}

/** 仮想スクロールで末尾行が DOM に無いとき用。Qwik 制御 input は keyboard で確実に filter を更新する */
export async function narrowItemsByFilter(page: Page, q: string) {
  const input = page.locator("#filter");
  await input.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(q, { delay: 8 });
  await expect
    .poll(async () => page.locator("td", { hasText: q }).count(), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

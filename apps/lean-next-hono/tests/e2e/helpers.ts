import { expect, type APIRequestContext, type Page, type Response } from "@playwright/test";

/** `src/lib/storage-keys.ts` の `STORAGE_ACCESS` と同一 */
export const LEAN_ACCESS_TOKEN_KEY = "lean_access_token";

export async function expectRestOkJson(res: Response): Promise<unknown> {
  const text = await res.text();
  expect(res.ok(), `HTTP ${res.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  if (!text.length) return null;
  return JSON.parse(text) as Record<string, unknown>;
}

export function waitForItemsPost(page: Page) {
  return page.waitForResponse(
    (res) => {
      if (res.request().method() !== "POST") return false;
      const p = new URL(res.url()).pathname;
      return /\/api\/items$/.test(p);
    },
    { timeout: 60_000 },
  );
}

export function waitForItemsPut(page: Page) {
  return page.waitForResponse(
    (res) => {
      if (res.request().method() !== "PUT") return false;
      return /\/api\/items\/.+/.test(new URL(res.url()).pathname);
    },
    { timeout: 60_000 },
  );
}

export function waitForItemsDelete(page: Page) {
  return page.waitForResponse(
    (res) => {
      if (res.request().method() !== "DELETE") return false;
      return /\/api\/items\/.+/.test(new URL(res.url()).pathname);
    },
    { timeout: 60_000 },
  );
}

export async function waitForDashboardReady(page: Page) {
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", level: 1 }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    page.getByText(/合計:/).or(page.getByText("集計")),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#filter")).toBeVisible({ timeout: 120_000 });
}

export async function narrowItemsByFilter(page: Page, q: string) {
  const input = page.locator("#filter");
  await input.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(q, { delay: 8 });
  await expect
    .poll(async () => page.getByText(q, { exact: true }).count(), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

/** 仮想リストの 1 行（タイトル + 編集ボタンで特定） */
export function itemRowByTitle(page: Page, title: string) {
  return page
    .locator("div")
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "編集" }) });
}

/** `GET /api/items?limit=&offset=` で全タイトル収集（E2E 用・件数小前提） */
export async function fetchAllItemTitlesViaRest(
  request: APIRequestContext,
  origin: string,
  token: string,
): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  const limit = 10_000;
  for (;;) {
    const res = await request.get(
      `${origin}/api/items?limit=${limit}&offset=${offset}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    await expectRestOkJson(res);
    const body = (await res.json()) as { items: { title: string }[] };
    const items = body.items ?? [];
    out.push(...items.map((i) => i.title));
    if (items.length < limit) break;
    offset += limit;
  }
  return out;
}

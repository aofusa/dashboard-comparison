import { and, asc, count, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { item } from "@/db/schema";

export type ItemRow = typeof item.$inferSelect;

export function itemToJson(row: ItemRow) {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listItemsPage(
  userId: string,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize;
  const [countRow] = await db
    .select({ n: count() })
    .from(item)
    .where(eq(item.userId, userId));
  const total = Number(countRow?.n ?? 0);
  const rows = await db
    .select()
    .from(item)
    .where(eq(item.userId, userId))
    .orderBy(desc(item.updatedAt), desc(item.id))
    .limit(pageSize)
    .offset(offset);
  return { items: rows.map(itemToJson), total, page, pageSize };
}

export async function listItemsSlice(
  userId: string,
  limit: number,
  offset: number,
) {
  const rows = await db
    .select()
    .from(item)
    .where(eq(item.userId, userId))
    .orderBy(desc(item.updatedAt), desc(item.id))
    .limit(limit)
    .offset(offset);
  return { items: rows.map(itemToJson) };
}

export async function listItemsUpdatedAfter(userId: string, afterIso: string) {
  const after = new Date(afterIso);
  if (Number.isNaN(after.getTime())) {
    return { items: [] as ReturnType<typeof itemToJson>[] };
  }
  const rows = await db
    .select()
    .from(item)
    .where(and(eq(item.userId, userId), gt(item.updatedAt, after)))
    .orderBy(asc(item.updatedAt), asc(item.id));
  return { items: rows.map(itemToJson) };
}

export async function createItem(userId: string, title: string) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(item).values({
    id,
    userId,
    title,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(item)
    .where(and(eq(item.id, id), eq(item.userId, userId)));
  if (!rows[0]) throw new Error("insert failed");
  return itemToJson(rows[0]);
}

export async function updateItem(
  userId: string,
  id: string,
  title: string,
): Promise<ReturnType<typeof itemToJson> | null> {
  const now = new Date();
  await db
    .update(item)
    .set({ title, updatedAt: now })
    .where(and(eq(item.id, id), eq(item.userId, userId)));
  const rows = await db
    .select()
    .from(item)
    .where(and(eq(item.id, id), eq(item.userId, userId)));
  return rows[0] ? itemToJson(rows[0]) : null;
}

export async function deleteItem(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .select({ id: item.id })
    .from(item)
    .where(and(eq(item.id, id), eq(item.userId, userId)));
  if (!rows[0]) return false;
  await db.delete(item).where(and(eq(item.id, id), eq(item.userId, userId)));
  return true;
}

export async function statsForUser(userId: string) {
  const letterExpr = sql<string>`SUBSTRING(COALESCE(NULLIF(TRIM(${item.title}), ''), ' '), 1, 1)`;
  const rows = await db
    .select({
      letter: letterExpr,
      cnt: sql<number>`count(*)`.mapWith(Number),
    })
    .from(item)
    .where(eq(item.userId, userId))
    .groupBy(letterExpr)
    .orderBy(asc(letterExpr));

  const [totalRow] = await db
    .select({ n: count() })
    .from(item)
    .where(eq(item.userId, userId));
  const total = Number(totalRow?.n ?? 0);

  return {
    total,
    by_initial: rows.map((r) => ({
      letter: r.letter,
      count: r.cnt,
    })),
  };
}

export async function idSetForUser(userId: string) {
  const rows = await db
    .select({ id: item.id })
    .from(item)
    .where(eq(item.userId, userId));
  return { ids: rows.map((r) => r.id) };
}

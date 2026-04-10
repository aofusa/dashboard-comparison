import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";

import {
  createItem,
  deleteItem,
  idSetForUser,
  listItemsPage,
  listItemsSlice,
  listItemsUpdatedAfter,
  statsForUser,
  updateItem,
} from "@/lib/items-service";
import { resolveUserIdFromRequest } from "@/lib/hono-resolve-user";

type Variables = { userId: string };

export const app = new OpenAPIHono<{ Variables: Variables }>().basePath(
  "/api",
);

/** Hono RPC クライアント（`hc<AppType>`）用 */
export type AppType = typeof app;

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "lean-next-hono",
    version: "0.1.0",
    description:
      "Next.js 14 + Hono 4 + Drizzle（仕様 v4.1.1）。性能テスト整合のため JWT Access/Refresh（MySQL）を追加。GraphQL・Arrow・一覧サーバキャッシュは未提供。",
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      description: "稼働確認",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            service: z.string(),
          }),
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) =>
  c.json({ status: "ok", service: "lean-next-hono" }),
);

const versionRoute = createRoute({
  method: "get",
  path: "/version",
  responses: {
    200: {
      description: "バージョン情報",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            version: z.string(),
            stack: z.string(),
          }),
        },
      },
    },
  },
});

app.openapi(versionRoute, (c) =>
  c.json({
    name: "lean-next-hono",
    version: "0.1.0",
    stack: "next14+hono4",
  }),
);

const itemJsonSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});

const unauthorized = {
  401: {
    description: "未認証",
    content: {
      "application/json": {
        schema: z.object({ error: z.string() }),
      },
    },
  },
} as const;

app.use("/items/*", async (c, next) => {
  const userId = await resolveUserIdFromRequest(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", userId);
  await next();
});

const itemsStatsRoute = createRoute({
  method: "get",
  path: "/items/stats",
  responses: {
    200: {
      description: "タイトル先頭文字ごとの件数（空タイトルはスペース扱い）",
      content: {
        "application/json": {
          schema: z.object({
            total: z.number(),
            by_initial: z.array(
              z.object({ letter: z.string(), count: z.number() }),
            ),
          }),
        },
      },
    },
    ...unauthorized,
  },
});

app.openapi(itemsStatsRoute, async (c) => {
  const userId = c.get("userId");
  const body = await statsForUser(userId);
  return c.json(body, 200);
});

const itemsIdSetRoute = createRoute({
  method: "get",
  path: "/items/id-set",
  responses: {
    200: {
      description: "当該ユーザーの全 item id",
      content: {
        "application/json": {
          schema: z.object({ ids: z.array(z.string()) }),
        },
      },
    },
    ...unauthorized,
  },
});

app.openapi(itemsIdSetRoute, async (c) => {
  const userId = c.get("userId");
  const body = await idSetForUser(userId);
  return c.json(body, 200);
});

const itemsListQuery = z.object({
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
  page_size: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  updated_after: z.string().optional(),
});

const itemsListRoute = createRoute({
  method: "get",
  path: "/items",
  request: { query: itemsListQuery },
  responses: {
    200: {
      description:
        "一覧。`updated_after` 指定時は `{ items }` のみ。`page`/`pageSize` 系が無く `limit`/`offset` があるときは `{ items }`。それ以外はページング形。",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(itemJsonSchema),
            total: z.number().optional(),
            page: z.number().optional(),
            pageSize: z.number().optional(),
          }),
        },
      },
    },
    ...unauthorized,
  },
});

function itemsListMode(q: z.infer<typeof itemsListQuery>) {
  const updatedAfter = q.updated_after?.trim() ?? "";
  const hasPage =
    q.page !== undefined ||
    q.pageSize !== undefined ||
    q.page_size !== undefined;
  const hasSlice = q.limit !== undefined || q.offset !== undefined;

  if (updatedAfter) {
    return { kind: "after" as const, updatedAfter };
  }
  if (!hasPage && hasSlice) {
    const limit = Math.min(10_000, Math.max(1, q.limit ?? 50));
    const offset = Math.max(0, q.offset ?? 0);
    return { kind: "slice" as const, limit, offset };
  }
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(
    200,
    Math.max(1, q.pageSize ?? q.page_size ?? 20),
  );
  return { kind: "page" as const, page, pageSize };
}

app.openapi(itemsListRoute, async (c) => {
  const userId = c.get("userId");
  const q = c.req.valid("query");
  const mode = itemsListMode(q);
  if (mode.kind === "after") {
    const body = await listItemsUpdatedAfter(userId, mode.updatedAfter);
    return c.json(body, 200);
  }
  if (mode.kind === "slice") {
    const body = await listItemsSlice(userId, mode.limit, mode.offset);
    return c.json(body, 200);
  }
  const body = await listItemsPage(userId, mode.page, mode.pageSize);
  return c.json(body, 200);
});

const itemsCreateBody = z.object({ title: z.string().min(1) });

const itemsPostRoute = createRoute({
  method: "post",
  path: "/items",
  request: {
    body: {
      content: { "application/json": { schema: itemsCreateBody } },
    },
  },
  responses: {
    201: {
      description: "作成",
      content: { "application/json": { schema: itemJsonSchema } },
    },
    ...unauthorized,
  },
});

app.openapi(itemsPostRoute, async (c) => {
  const userId = c.get("userId");
  const { title } = c.req.valid("json");
  const row = await createItem(userId, title);
  return c.json(row, 201);
});

const itemsPutRoute = createRoute({
  method: "put",
  path: "/items/{id}",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: itemsCreateBody } },
    },
  },
  responses: {
    200: {
      description: "更新",
      content: { "application/json": { schema: itemJsonSchema } },
    },
    404: {
      description: "見つからない",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    ...unauthorized,
  },
});

app.openapi(itemsPutRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const { title } = c.req.valid("json");
  const row = await updateItem(userId, id, title);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row, 200);
});

const itemsDeleteRoute = createRoute({
  method: "delete",
  path: "/items/{id}",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: "削除" },
    404: {
      description: "見つからない",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    ...unauthorized,
  },
});

app.openapi(itemsDeleteRoute, async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.valid("param");
  const ok = await deleteItem(userId, id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

app.get("/swagger", swaggerUI({ url: "/api/openapi.json" }));

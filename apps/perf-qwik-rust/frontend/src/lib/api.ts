import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  refreshRequest,
  setTokens,
} from "./auth";

/** バックエンド `main.rs` と揃える（Arrow バイナリ `Accept`）。 */
export const MIME_ARROW_VND =
  "application/vnd.apache.arrow.stream; codecs=zstd";
export const MIME_ARROW_LEGACY = "application/x-arrow-ipc+zstd";

const GQL_PATH = "/api/graphql";

export type ItemRow = {
  id: string;
  title: string;
  updated_at?: string | null;
};

export type ItemsStats = {
  total: number;
  by_initial: { letter: string; count: number }[];
};

type GqlErrorShape = {
  message: string;
  extensions?: { code?: number };
};

function isUnauthorizedError(errors: GqlErrorShape[] | undefined): boolean {
  return !!errors?.some((e) => e.extensions?.code === 401);
}

async function withAuth(
  input: RequestInfo,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401 && !retried && getRefreshToken()) {
    const body = await refreshRequest();
    if (body) {
      setTokens(body.token, body.refresh_token);
      return withAuth(input, init, true);
    }
    clearTokens();
  }
  return res;
}

async function graphqlJson<T>(
  payload: {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
  },
  retried = false,
): Promise<T> {
  const res = await withAuth(GQL_PATH, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 && !retried && getRefreshToken()) {
    const body = await refreshRequest();
    if (body) {
      setTokens(body.token, body.refresh_token);
      return graphqlJson<T>(payload, true);
    }
    clearTokens();
  }
  const text = await res.text();
  let j: { data?: T; errors?: GqlErrorShape[] };
  try {
    j = JSON.parse(text) as { data?: T; errors?: GqlErrorShape[] };
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (j.errors?.length) {
    if (!retried && isUnauthorizedError(j.errors) && getRefreshToken()) {
      const body = await refreshRequest();
      if (body) {
        setTokens(body.token, body.refresh_token);
        return graphqlJson<T>(payload, true);
      }
      clearTokens();
    }
    throw new Error(j.errors[0]?.message || "GraphQL error");
  }
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (j.data === undefined || j.data === null) {
    throw new Error("GraphQL: empty data");
  }
  return j.data;
}

function mapItem(g: {
  id: string;
  title: string;
  updatedAt?: string | null;
}): ItemRow {
  return {
    id: g.id,
    title: g.title,
    updated_at: g.updatedAt ?? null,
  };
}

const APP_DASHBOARD_GQL = `
  query AppDashboardLoader($limit: Int!) {
    slice: itemsSlice(limit: $limit, offset: 0) {
      items { id title updatedAt }
    }
    stats: itemStats {
      total
      byInitial { letter count }
    }
  }
`;

/** `routeLoader$` 用: Cookie 付きで GraphQL。JWT のみの初回は 401 → クライアントで再取得。 */
export async function fetchDashboardLoaderData(ev: {
  url: { origin: string };
  request: { headers: Headers };
}): Promise<
  | { ok: true; items: ItemRow[]; stats: ItemsStats }
  | { ok: false; needClient: true }
> {
  const LOADER_LIMIT = 65535;
  const origin = ev.url.origin;
  const cookie = ev.request.headers.get("cookie") ?? "";
  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const res = await fetch(new URL("/api/graphql", origin), {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: APP_DASHBOARD_GQL,
      variables: { limit: LOADER_LIMIT },
      operationName: "AppDashboardLoader",
    }),
  });
  if (res.status === 401) {
    return { ok: false, needClient: true };
  }
  type GqlErr = { message: string; extensions?: { code?: number } };
  let j: {
    data?: {
      slice: {
        items: { id: string; title: string; updatedAt?: string | null }[];
      };
      stats: {
        total: number;
        byInitial: { letter: string; count: number }[];
      };
    };
    errors?: GqlErr[];
  };
  try {
    j = (await res.json()) as typeof j;
  } catch {
    return { ok: false, needClient: true };
  }
  if (j.errors?.length) {
    const unauth = j.errors.some((e) => e.extensions?.code === 401);
    if (unauth) return { ok: false, needClient: true };
    return { ok: false, needClient: true };
  }
  if (!res.ok || !j.data) {
    return { ok: false, needClient: true };
  }
  const items: ItemRow[] = j.data.slice.items.map((r) => ({
    id: r.id,
    title: r.title,
    updated_at: r.updatedAt ?? null,
  }));
  const stats: ItemsStats = {
    total: j.data.stats.total,
    by_initial: j.data.stats.byInitial.map((b) => ({
      letter: b.letter,
      count: b.count,
    })),
  };
  return { ok: true, items, stats };
}

export async function apiItemsList(opts?: {
  limit?: number;
  offset?: number;
}): Promise<ItemRow[]> {
  const limit = opts?.limit ?? 100_000;
  const offset = opts?.offset ?? 0;
  const data = await graphqlJson<{
    itemsSlice: { items: { id: string; title: string; updatedAt?: string | null }[] };
  }>({
    query: `
      query ItemsSlice($limit: Int!, $offset: Int!) {
        itemsSlice(limit: $limit, offset: $offset) {
          items { id title updatedAt }
        }
      }`,
    variables: { limit, offset },
    operationName: "ItemsSlice",
  });
  return data.itemsSlice.items.map(mapItem);
}

export async function apiItemsUpdatedAfter(iso: string): Promise<ItemRow[]> {
  const data = await graphqlJson<{
    itemsUpdatedAfter: {
      items: { id: string; title: string; updatedAt?: string | null }[];
    };
  }>({
    query: `
      query ItemsUpdatedAfter($updatedAfter: String!) {
        itemsUpdatedAfter(updatedAfter: $updatedAfter) {
          items { id title updatedAt }
        }
      }`,
    variables: { updatedAfter: iso },
    operationName: "ItemsUpdatedAfter",
  });
  return data.itemsUpdatedAfter.items.map(mapItem);
}

export async function apiItemsStats(): Promise<ItemsStats> {
  const data = await graphqlJson<{
    itemStats: {
      total: number;
      byInitial: { letter: string; count: number }[];
    };
  }>({
    query: `
      query ItemStats {
        itemStats {
          total
          byInitial { letter count }
        }
      }`,
    operationName: "ItemStats",
  });
  return {
    total: data.itemStats.total,
    by_initial: data.itemStats.byInitial.map((b) => ({
      letter: b.letter,
      count: b.count,
    })),
  };
}

export async function apiItemsIdSet(): Promise<string[]> {
  const data = await graphqlJson<{ itemIds: string[] }>({
    query: `query ItemIds { itemIds }`,
    operationName: "ItemIds",
  });
  return data.itemIds;
}

export async function apiItemCreate(title: string): Promise<ItemRow> {
  const data = await graphqlJson<{
    createItem: { id: string; title: string; updatedAt?: string | null };
  }>({
    query: `
      mutation CreateItem($title: String!) {
        createItem(title: $title) { id title updatedAt }
      }`,
    variables: { title },
    operationName: "CreateItem",
  });
  return mapItem(data.createItem);
}

export async function apiItemUpdate(id: string, title: string): Promise<void> {
  await graphqlJson<{ updateItem: { id: string } }>({
    query: `
      mutation UpdateItem($id: String!, $title: String!) {
        updateItem(id: $id, title: $title) { id title updatedAt }
      }`,
    variables: { id, title },
    operationName: "UpdateItem",
  });
}

export async function apiItemDelete(id: string): Promise<void> {
  await graphqlJson<{ deleteItem: boolean }>({
    query: `
      mutation DeleteItem($id: String!) {
        deleteItem(id: $id)
      }`,
    variables: { id },
    operationName: "DeleteItem",
  });
}

/** Arrow IPC + Zstd 生バイナリ（`operationName: ItemsArrowBinary` + `Accept`）。 */
export async function apiItemsArrowBuffer(): Promise<ArrayBuffer> {
  const payload = {
    query: `query ItemsArrowBinary { itemsArrowBinary }`,
    operationName: "ItemsArrowBinary" as const,
  };
  const run = async (retried: boolean): Promise<ArrayBuffer> => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set(
      "Accept",
      `${MIME_ARROW_VND}, ${MIME_ARROW_LEGACY}, application/json;q=0.1`,
    );
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res = await fetch(GQL_PATH, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (res.status === 401 && !retried && getRefreshToken()) {
      const body = await refreshRequest();
      if (body) {
        setTokens(body.token, body.refresh_token);
        return run(true);
      }
      clearTokens();
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `arrow: HTTP ${res.status}`);
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (
      ct.includes("arrow") ||
      ct.includes("application/vnd.apache.arrow") ||
      ct.includes("x-arrow-ipc")
    ) {
      return res.arrayBuffer();
    }
    const text = await res.text();
    let j: { errors?: GqlErrorShape[] };
    try {
      j = JSON.parse(text) as { errors?: GqlErrorShape[] };
    } catch {
      throw new Error(`arrow: unexpected response (${ct})`);
    }
    if (!retried && isUnauthorizedError(j.errors) && getRefreshToken()) {
      const body = await refreshRequest();
      if (body) {
        setTokens(body.token, body.refresh_token);
        return run(true);
      }
      clearTokens();
    }
    throw new Error(j.errors?.[0]?.message || "arrow: JSON error body");
  };
  return run(false);
}

import {
  $,
  component$,
  useComputed$,
  useOnWindow,
  useSignal,
  useTask$,
  useVisibleTask$,
} from "@builder.io/qwik";
import {
  type DocumentHead,
  routeLoader$,
} from "@builder.io/qwik-city";
import { Button, Input, Label, Modal } from "~/components/ui";
import {
  apiItemCreate,
  apiItemDelete,
  apiItemUpdate,
  apiItemsArrowBuffer,
  apiItemsIdSet,
  apiItemsList,
  apiItemsStats,
  apiItemsUpdatedAfter,
  type ItemRow,
  type ItemsStats,
} from "~/lib/api";
import { tryWriteArrowIpcToOpfs } from "~/lib/opfsArrowCache";
import {
  type ArrowPreview,
  decodeArrowZstdFull,
} from "~/lib/arrowZstd";
import {
  type DuckdbArrowSmokeResult,
  queryArrowIpcSmoke,
} from "~/lib/duckdbWasm";

type ItemModal = "none" | "create" | "edit" | "delete";

const VIRT_ROW = 48;
const VIRT_VIEW = 440;
const APP_ITEMS_LIMIT = 65535;

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

/** Cookie セッション付きなら SSR / Link 遷移で一覧取得。JWT のみの初回は `needClient` になりクライアントで `reload`。 */
export const useAppDashboardLoader = routeLoader$(async (ev) => {
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
      variables: { limit: APP_ITEMS_LIMIT },
      operationName: "AppDashboardLoader",
    }),
  });
  if (res.status === 401) {
    return { ok: false as const, needClient: true };
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
    return { ok: false as const, needClient: true };
  }
  if (j.errors?.length) {
    const unauth = j.errors.some((e) => e.extensions?.code === 401);
    if (unauth) return { ok: false as const, needClient: true };
    return { ok: false as const, needClient: true };
  }
  if (!res.ok || !j.data) {
    return { ok: false as const, needClient: true };
  }
  const items: ItemRow[] = j.data.slice.items.map((r) => ({
    id: r.id,
    title: r.title,
    updated_at: r.updatedAt ?? null,
  }));
  const stats: ItemsStats | null = j.data.stats
    ? {
        total: j.data.stats.total,
        by_initial: j.data.stats.byInitial.map((b) => ({
          letter: b.letter,
          count: b.count,
        })),
      }
    : null;
  return { ok: true as const, items, stats };
});

export default component$(() => {
  const loaderData = useAppDashboardLoader();
  const items = useSignal<ItemRow[]>([]);
  const loadError = useSignal("");
  const busy = useSignal(false);
  const filter = useSignal("");
  const sortKey = useSignal<"id" | "title" | "updated_at">("title");
  const sortAsc = useSignal(true);
  const stats = useSignal<ItemsStats | null>(null);
  const virtScrollTop = useSignal(0);
  const modal = useSignal<ItemModal>("none");
  const modalOpen = useSignal(false);
  const editId = useSignal<string | null>(null);
  const draftTitle = useSignal("");
  const actionError = useSignal("");
  const arrowHint = useSignal("");
  const arrowPreview = useSignal<ArrowPreview | null>(null);
  /** 最後に取得した Arrow IPC ストリーム（Zstd 展開後）。DuckDB 投入用。 */
  const arrowIpcRaw = useSignal<Uint8Array | null>(null);
  const duckdbHint = useSignal("");
  const duckdbResult = useSignal<DuckdbArrowSmokeResult | null>(null);

  const reload = $(async () => {
    loadError.value = "";
    try {
      items.value = await apiItemsList({ limit: APP_ITEMS_LIMIT });
      try {
        stats.value = await apiItemsStats();
      } catch {
        stats.value = null;
      }
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e);
    }
  });

  // routeLoader$ の結果をシグナルへ（SSR・クライアントナビ共通）。ok なら二重フェッチを避ける。
  useTask$(({ track }) => {
    track(() => loaderData.value);
    const v = loaderData.value;
    if (v && "ok" in v && v.ok) {
      items.value = v.items;
      stats.value = v.stats;
    }
  });

  // Loader が 401（Cookie なし等）のときのみ Bearer で再取得
  // eslint-disable-next-line qwik/no-use-visible-task -- localStorage の JWT はブラウザのみ
  useVisibleTask$(async () => {
    const v = loaderData.value;
    if (v && "ok" in v && v.ok) return;
    await reload();
  });

  /**
   * フォーカス復帰: (1) `updated_after` で追加・更新をマージ (2) `id-set` でサーバに無い id を削除（Q2）。
   * 優先: 差分の方が先。id 集合は物理削除後の真実とみなす。
   */
  useOnWindow(
    "focus",
    $(async () => {
      if (items.value.length === 0) return;

      let changed = false;
      let best = -1;
      let bestS: string | null = null;
      for (const r of items.value) {
        if (!r.updated_at) continue;
        const t = Date.parse(r.updated_at);
        if (Number.isFinite(t) && t > best) {
          best = t;
          bestS = r.updated_at;
        }
      }
      if (bestS) {
        try {
          const delta = await apiItemsUpdatedAfter(bestS);
          if (delta.length > 0) {
            const m = new Map(items.value.map((r) => [r.id, { ...r }]));
            for (const d of delta) {
              m.set(d.id, { ...d });
            }
            items.value = Array.from(m.values());
            changed = true;
          }
        } catch {
          /* 差分失敗は無視 */
        }
      }

      try {
        const serverIds = await apiItemsIdSet();
        const alive = new Set(serverIds);
        const next = items.value.filter((r) => alive.has(r.id));
        if (next.length !== items.value.length) {
          items.value = next;
          changed = true;
        }
        if (changed) {
          try {
            stats.value = await apiItemsStats();
          } catch {
            stats.value = null;
          }
        }
      } catch {
        /* id-set は無視 */
      }
    }),
  );

  const filtered = useComputed$(() => {
    const q = filter.value.trim().toLowerCase();
    let rows = items.value.filter(
      (i) => !q || i.title.toLowerCase().includes(q),
    );
    const k = sortKey.value;
    const asc = sortAsc.value ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va =
        k === "title"
          ? a.title
          : k === "updated_at"
            ? a.updated_at ?? ""
            : a.id;
      const vb =
        k === "title"
          ? b.title
          : k === "updated_at"
            ? b.updated_at ?? ""
            : b.id;
      return va < vb ? -asc : va > vb ? asc : 0;
    });
    return rows;
  });

  const virtWindow = useComputed$(() => {
    const rows = filtered.value;
    const st = virtScrollTop.value;
    const start = Math.max(0, Math.floor(st / VIRT_ROW));
    const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
    const end = Math.min(rows.length, start + count);
    const slice = rows.slice(start, end);
    const padTop = start * VIRT_ROW;
    const padBottom = Math.max(0, (rows.length - end) * VIRT_ROW);
    return { slice, padTop, padBottom, total: rows.length };
  });

  const openCreate = $(() => {
    actionError.value = "";
    draftTitle.value = "";
    modal.value = "create";
    modalOpen.value = true;
  });

  const clickEdit = $((ev: Event) => {
    const id = (ev.currentTarget as HTMLElement).dataset.itemId;
    if (!id) return;
    const row = items.value.find((i) => i.id === id);
    if (!row) return;
    actionError.value = "";
    editId.value = row.id;
    draftTitle.value = row.title;
    modal.value = "edit";
    modalOpen.value = true;
  });

  const clickDelete = $((ev: Event) => {
    const id = (ev.currentTarget as HTMLElement).dataset.itemId;
    if (!id) return;
    const row = items.value.find((i) => i.id === id);
    if (!row) return;
    actionError.value = "";
    editId.value = row.id;
    draftTitle.value = row.title;
    modal.value = "delete";
    modalOpen.value = true;
  });

  const closeModal = $(() => {
    modal.value = "none";
    editId.value = null;
    modalOpen.value = false;
  });

  const submitCreate = $(async () => {
    actionError.value = "";
    busy.value = true;
    try {
      await apiItemCreate(draftTitle.value.trim());
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await reload();
    } catch (e) {
      actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  const submitEdit = $(async () => {
    const id = editId.value;
    if (!id) return;
    actionError.value = "";
    busy.value = true;
    try {
      await apiItemUpdate(id, draftTitle.value.trim());
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await reload();
    } catch (e) {
      actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  const submitDelete = $(async () => {
    const id = editId.value;
    if (!id) return;
    actionError.value = "";
    busy.value = true;
    try {
      await apiItemDelete(id);
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await reload();
    } catch (e) {
      actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  const fetchArrow = $(async () => {
    arrowPreview.value = null;
    arrowIpcRaw.value = null;
    duckdbResult.value = null;
    duckdbHint.value = "";
    arrowHint.value = "取得中…";
    try {
      const buf = await apiItemsArrowBuffer();
      const { preview, ipcStream } = await decodeArrowZstdFull(buf);
      arrowPreview.value = preview;
      arrowIpcRaw.value = ipcStream;
      void tryWriteArrowIpcToOpfs(ipcStream);
      arrowHint.value = `Arrow IPC + Zstd: 圧縮 ${buf.byteLength} bytes → 行数 ${preview.rowCount}（先頭 ${preview.previewLimit} 行を表示）`;
    } catch (e) {
      arrowHint.value =
        e instanceof Error ? e.message : String(e);
    }
  });

  const runDuckdbSmoke = $(async () => {
    const ipc = arrowIpcRaw.value;
    if (!ipc) return;
    duckdbResult.value = null;
    duckdbHint.value = "DuckDB-WASM 初期化・照会中…";
    try {
      const r = await queryArrowIpcSmoke(ipc);
      duckdbResult.value = r;
      duckdbHint.value = `DuckDB: ${r.version}`;
    } catch (e) {
      duckdbHint.value = e instanceof Error ? e.message : String(e);
    }
  });

  return (
    <div>
      <h1 class="mt-0 text-xl font-semibold tracking-tight">アイテム</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        フィルタ・ソートはクライアント側。データは{" "}
        <code>POST /api/graphql</code>（<code>itemsSlice</code> /{" "}
        <code>itemStats</code> / <code>itemsUpdatedAfter</code> など）。
      </p>

      {loadError.value ? (
        <div
          class="mb-4 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
          role="alert"
        >
          {loadError.value}
        </div>
      ) : null}

      {stats.value ? (
        <div class="mb-3 text-sm text-muted-foreground">
          <strong>総件数 {stats.value.total}</strong>
          {" · "}
          <span>タイトル先頭文字別: </span>
          {stats.value.by_initial.slice(0, 32).map((b) => (
            <span key={b.letter} style={{ marginRight: "0.45rem" }}>
              {b.letter}: {b.count}
            </span>
          ))}
        </div>
      ) : null}

      <div class="toolbar">
        <div class="flex flex-col gap-2">
          <Label for="filter">タイトル検索</Label>
          <Input
            id="filter"
            placeholder="部分一致…"
            value={filter.value}
            onInput$={(ev) => {
              filter.value = (ev.target as HTMLInputElement).value;
              virtScrollTop.value = 0;
            }}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="sort">ソート</Label>
          <select
            id="sort"
            class="select-field"
            value={sortKey.value}
            onChange$={(ev) => {
              sortKey.value = (ev.target as HTMLSelectElement)
                .value as typeof sortKey.value;
              virtScrollTop.value = 0;
            }}
          >
            <option value="title">タイトル</option>
            <option value="id">ID</option>
            <option value="updated_at">更新</option>
          </select>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="order">順序</Label>
          <select
            id="order"
            class="select-field"
            value={sortAsc.value ? "asc" : "desc"}
            onChange$={(ev) => {
              sortAsc.value =
                (ev.target as HTMLSelectElement).value === "asc";
              virtScrollTop.value = 0;
            }}
          >
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </div>
        <div class="toolbar-actions">
          <Button type="button" onClick$={openCreate}>
            追加
          </Button>
          <Button type="button" look="outline" onClick$={reload}>
            再読込
          </Button>
          <Button type="button" look="outline" onClick$={fetchArrow}>
            Arrow 取得
          </Button>
          <Button
            type="button"
            look="outline"
            disabled={!arrowIpcRaw.value}
            onClick$={runDuckdbSmoke}
          >
            DuckDB で照会
          </Button>
        </div>
      </div>

      {arrowHint.value ? (
        <p class="hint mb-2">{arrowHint.value}</p>
      ) : null}

      {arrowPreview.value ? (
        <div class="table-wrap mb-4">
          <p class="mb-2 text-sm text-muted-foreground">
            Arrow プレビュー（apache-arrow + fzstd）
          </p>
          <table class="data">
            <thead>
              <tr>
                {arrowPreview.value.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arrowPreview.value.rows.map((r, idx) => (
                <tr key={idx}>
                  {arrowPreview.value!.columns.map((c) => (
                    <td key={c} class="text-xs text-muted-foreground">
                      {r[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {duckdbHint.value ? (
        <p class="hint mb-2">{duckdbHint.value}</p>
      ) : null}

      {duckdbResult.value ? (
        <div class="table-wrap mb-4">
          <p class="mb-2 text-sm text-muted-foreground">
            DuckDB-WASM（<code>{duckdbResult.value.countSql}</code> /{" "}
            <code>{duckdbResult.value.sampleSql}</code>）
          </p>
          <p class="mb-1 text-xs text-muted-foreground">
            件数:{" "}
            <strong>
              {duckdbResult.value.countRows[0]?.cnt ?? "—"}
            </strong>
          </p>
          <table class="data">
            <thead>
              <tr>
                {duckdbResult.value.sampleRows[0]
                  ? Object.keys(duckdbResult.value.sampleRows[0]).map(
                      (k) => (
                        <th key={k}>{k}</th>
                      ),
                    )
                  : null}
              </tr>
            </thead>
            <tbody>
              {duckdbResult.value.sampleRows.map((r, idx) => (
                <tr key={idx}>
                  {Object.entries(r).map(([k, v]) => (
                    <td key={k} class="text-xs text-muted-foreground">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div
        class="virt-scroller table-wrap"
        style={{
          maxHeight: `${VIRT_VIEW}px`,
          overflow: "auto",
          marginBottom: "0.35rem",
        }}
        onScroll$={(ev) => {
          virtScrollTop.value = (ev.target as HTMLDivElement).scrollTop;
        }}
      >
        <table class="data">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>ID</th>
              <th>更新</th>
              <th style={{ width: "1%" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {virtWindow.value.total === 0 ? (
              <tr>
                <td colSpan={4} class="text-muted-foreground">
                  行がありません
                </td>
              </tr>
            ) : (
              <>
                <tr aria-hidden="true">
                  <td
                    colSpan={4}
                    style={{
                      padding: 0,
                      border: "none",
                      height: `${virtWindow.value.padTop}px`,
                    }}
                  />
                </tr>
                {virtWindow.value.slice.map((row) => (
                  <tr key={row.id} style={{ height: `${VIRT_ROW}px` }}>
                    <td>{row.title}</td>
                    <td>
                      <code style={{ fontSize: "0.75rem" }}>{row.id}</code>
                    </td>
                    <td class="text-muted-foreground">
                      {row.updated_at ?? "—"}
                    </td>
                    <td class="whitespace-nowrap">
                      <Button
                        type="button"
                        look="outline"
                        size="sm"
                        class="mr-1"
                        data-item-id={row.id}
                        onClick$={clickEdit}
                      >
                        編集
                      </Button>
                      <Button
                        type="button"
                        look="alert"
                        size="sm"
                        data-item-id={row.id}
                        onClick$={clickDelete}
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr aria-hidden="true">
                  <td
                    colSpan={4}
                    style={{
                      padding: 0,
                      border: "none",
                      height: `${virtWindow.value.padBottom}px`,
                    }}
                  />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p class="mb-4 text-xs text-muted-foreground">
        表示中フィルタ後 {filtered.value.length} 件 · 仮想スクロール（行高さ約 {VIRT_ROW}
        px）。フォーカス復帰時: <code>itemsUpdatedAfter</code> で他タブの追加・更新をマージし、
        <code>itemIds</code> で他タブの削除を同期。
      </p>

      <Modal.Root
        bind:show={modalOpen}
        onClose$={$(() => {
          modal.value = "none";
          editId.value = null;
        })}
      >
        <Modal.Panel>
          {modal.value === "create" ? (
            <>
              <Modal.Title>アイテムを追加</Modal.Title>
              {actionError.value ? (
                <div
                  class="mt-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                  role="alert"
                >
                  {actionError.value}
                </div>
              ) : null}
              <div class="mt-4 flex flex-col gap-2">
                <Label for="draft">タイトル</Label>
                <Input id="draft" bind:value={draftTitle} />
              </div>
              <div class="mt-6 flex flex-wrap justify-end gap-2">
                <Button type="button" look="outline" onClick$={closeModal}>
                  キャンセル
                </Button>
                <Button
                  type="button"
                  disabled={busy.value}
                  onClick$={submitCreate}
                >
                  作成
                </Button>
              </div>
            </>
          ) : null}
          {modal.value === "edit" ? (
            <>
              <Modal.Title>アイテムを編集</Modal.Title>
              {actionError.value ? (
                <div
                  class="mt-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                  role="alert"
                >
                  {actionError.value}
                </div>
              ) : null}
              <div class="mt-4 flex flex-col gap-2">
                <Label for="draft2">タイトル</Label>
                <Input id="draft2" bind:value={draftTitle} />
              </div>
              <div class="mt-6 flex flex-wrap justify-end gap-2">
                <Button type="button" look="outline" onClick$={closeModal}>
                  キャンセル
                </Button>
                <Button
                  type="button"
                  disabled={busy.value}
                  onClick$={submitEdit}
                >
                  保存
                </Button>
              </div>
            </>
          ) : null}
          {modal.value === "delete" ? (
            <>
              <Modal.Title>削除の確認</Modal.Title>
              {actionError.value ? (
                <div
                  class="mt-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                  role="alert"
                >
                  {actionError.value}
                </div>
              ) : null}
              <p class="mt-3 text-sm text-foreground">
                「<strong>{draftTitle.value}</strong>」を削除しますか？
              </p>
              <div class="mt-6 flex flex-wrap justify-end gap-2">
                <Button type="button" look="outline" onClick$={closeModal}>
                  キャンセル
                </Button>
                <Button
                  type="button"
                  look="alert"
                  disabled={busy.value}
                  onClick$={submitDelete}
                >
                  削除
                </Button>
              </div>
            </>
          ) : null}
        </Modal.Panel>
      </Modal.Root>
    </div>
  );
});

export const head: DocumentHead = {
  title: "ダッシュボード | lowspec-qwik-rust",
};

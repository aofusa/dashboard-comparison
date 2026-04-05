import {
  $,
  component$,
  useComputed$,
  useOnWindow,
  useSignal,
  useVisibleTask$,
} from "@builder.io/qwik";
import { type DocumentHead, routeLoader$ } from "@builder.io/qwik-city";
import { ItemRowActions } from "~/components/dashboard/ItemRowActions";
import { Button, Input, Label, Modal } from "~/components/ui";
import {
  apiItemCreate,
  apiItemDelete,
  apiItemUpdate,
  apiItemsIdSet,
  apiItemsUpdatedAfter,
  type ItemRow,
  type ItemsStats,
} from "~/lib/api";
import {
  applyFullResyncFromPrefetch,
  startArrowIpcPrefetch,
} from "~/lib/dashboardArrowPrefetch";
import {
  itemsDbApplyDelta,
  itemsDbApplyMutation,
  itemsDbGetMaxUpdatedAt,
  itemsDbInit,
  itemsDbQueryStats,
  itemsDbQueryWindow,
  itemsDbReconcileIds,
  itemsDbRowCount,
  namespaceFromAccessToken,
} from "~/lib/itemsDbClient";
import { getAccessToken } from "~/lib/auth";

type ItemModal = "none" | "create" | "edit" | "delete";

const VIRT_ROW = 48;
const VIRT_VIEW = 440;

/** SSR では DuckDB を使わない。実データはクライアントで Worker 初期化後に DuckDB SSOT へ載せる。 */
export const useAppDashboardLoader = routeLoader$(async () => {
  return { ok: true as const };
});

export default component$(() => {
  const loaderData = useAppDashboardLoader();
  const loadError = useSignal("");
  const busy = useSignal(false);
  const filter = useSignal("");
  const sortKey = useSignal<"id" | "title" | "updated_at">("title");
  const sortAsc = useSignal(true);
  const stats = useSignal<ItemsStats | null>(null);
  const virtScrollTop = useSignal(0);
  /** DuckDB queryWindow の結果（仮想ウィンドウ分のみ） */
  const windowRows = useSignal<ItemRow[]>([]);
  const windowTotal = useSignal(0);
  const dbReady = useSignal(false);
  const modal = useSignal<ItemModal>("none");
  const modalOpen = useSignal(false);
  const editId = useSignal<string | null>(null);
  const draftTitle = useSignal("");
  const actionError = useSignal("");

  const virtPad = useComputed$(() => {
    const st = virtScrollTop.value;
    const total = windowTotal.value;
    const start = Math.max(0, Math.floor(st / VIRT_ROW));
    const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
    const end = Math.min(total, start + count);
    const padTop = start * VIRT_ROW;
    const padBottom = Math.max(0, (total - end) * VIRT_ROW);
    return { padTop, padBottom, total };
  });

  // eslint-disable-next-line qwik/no-use-visible-task -- DuckDB Worker はブラウザのみ
  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => loaderData.value);
    const ac = new AbortController();
    cleanup(() => ac.abort());
    loadError.value = "";
    try {
      const ns = namespaceFromAccessToken(getAccessToken());
      const arrowPref = startArrowIpcPrefetch(ac.signal);
      await itemsDbInit({ namespace: ns });
      if (ac.signal.aborted) return;
      dbReady.value = true;
      const n = await itemsDbRowCount();
      if (ac.signal.aborted) return;
      if (n === 0) {
        await applyFullResyncFromPrefetch(arrowPref, ac.signal);
      }
      if (ac.signal.aborted) return;
      const st = virtScrollTop.value;
      const start = Math.max(0, Math.floor(st / VIRT_ROW));
      const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
      const r = await itemsDbQueryWindow({
        filter: filter.value,
        sortKey: sortKey.value,
        sortAsc: sortAsc.value,
        offset: start,
        limit: count,
      });
      if (ac.signal.aborted) return;
      windowRows.value = r.rows;
      windowTotal.value = r.total;
      stats.value = await itemsDbQueryStats();
    } catch (e) {
      if (!ac.signal.aborted) {
        loadError.value = e instanceof Error ? e.message : String(e);
      }
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    track(() => filter.value);
    track(() => sortKey.value);
    track(() => sortAsc.value);
    track(() => virtScrollTop.value);
    track(() => dbReady.value);
    if (!dbReady.value) return;
    const ac = new AbortController();
    cleanup(() => ac.abort());
    const tid = window.setTimeout(async () => {
      try {
        if (ac.signal.aborted) return;
        const st = virtScrollTop.value;
        const start = Math.max(0, Math.floor(st / VIRT_ROW));
        const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
        const r = await itemsDbQueryWindow({
          filter: filter.value,
          sortKey: sortKey.value,
          sortAsc: sortAsc.value,
          offset: start,
          limit: count,
        });
        if (ac.signal.aborted) return;
        windowRows.value = r.rows;
        windowTotal.value = r.total;
      } catch (e) {
        if (!ac.signal.aborted) {
          loadError.value = e instanceof Error ? e.message : String(e);
        }
      }
    }, 48);
    cleanup(() => {
      window.clearTimeout(tid);
      ac.abort();
    });
  });

  useOnWindow(
    "focus",
    $(async () => {
      if (!dbReady.value) return;
      const total = windowTotal.value;
      if (total === 0 && (await itemsDbRowCount()) === 0) return;
      try {
        const maxU = await itemsDbGetMaxUpdatedAt();
        const nRows = await itemsDbRowCount();
        // max_updated_at が空だと falsy で差分同期が丸ごとスキップされ、サーバ更新がローカルに反映されない
        const after =
          maxU.trim() !== ""
            ? maxU
            : nRows > 0
              ? "1970-01-01T00:00:00Z"
              : "";
        if (after) {
          const delta = await apiItemsUpdatedAfter(after);
          if (delta.length > 0) {
            await itemsDbApplyDelta({ upserts: delta });
          }
        }
        const serverIds = await apiItemsIdSet();
        await itemsDbReconcileIds({ ids: serverIds });
        const st = virtScrollTop.value;
        const start = Math.max(0, Math.floor(st / VIRT_ROW));
        const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
        const r = await itemsDbQueryWindow({
          filter: filter.value,
          sortKey: sortKey.value,
          sortAsc: sortAsc.value,
          offset: start,
          limit: count,
        });
        windowRows.value = r.rows;
        windowTotal.value = r.total;
        stats.value = await itemsDbQueryStats();
      } catch {
        /* 同期失敗は無視 */
      }
    }),
  );

  const fullResync = $(async () => {
    loadError.value = "";
    busy.value = true;
    try {
      const ac = new AbortController();
      await applyFullResyncFromPrefetch(
        startArrowIpcPrefetch(ac.signal),
        ac.signal,
      );
      const st = virtScrollTop.value;
      const start = Math.max(0, Math.floor(st / VIRT_ROW));
      const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
      const r = await itemsDbQueryWindow({
        filter: filter.value,
        sortKey: sortKey.value,
        sortAsc: sortAsc.value,
        offset: start,
        limit: count,
      });
      windowRows.value = r.rows;
      windowTotal.value = r.total;
      stats.value = await itemsDbQueryStats();
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  const openCreate = $(() => {
    actionError.value = "";
    draftTitle.value = "";
    modal.value = "create";
    modalOpen.value = true;
  });

  /** Esc / バックドロップ / キャンセル共通。bind:show と dialog.open をずらさないよう modalOpen を必ず下げる */
  const closeModal = $(() => {
    modal.value = "none";
    editId.value = null;
    modalOpen.value = false;
  });

  const openEditRow = $((id: string, title: string) => {
    actionError.value = "";
    editId.value = id;
    draftTitle.value = title;
    modal.value = "edit";
    modalOpen.value = true;
  });

  const openDeleteRow = $((id: string, title: string) => {
    actionError.value = "";
    editId.value = id;
    draftTitle.value = title;
    modal.value = "delete";
    modalOpen.value = true;
  });

  const refreshAfterMutation = $(async () => {
    const st = virtScrollTop.value;
    const start = Math.max(0, Math.floor(st / VIRT_ROW));
    const count = Math.ceil(VIRT_VIEW / VIRT_ROW) + 4;
    const r = await itemsDbQueryWindow({
      filter: filter.value,
      sortKey: sortKey.value,
      sortAsc: sortAsc.value,
      offset: start,
      limit: count,
    });
    windowRows.value = r.rows;
    windowTotal.value = r.total;
    stats.value = await itemsDbQueryStats();
  });

  const submitCreate = $(async () => {
    actionError.value = "";
    busy.value = true;
    try {
      const row = await apiItemCreate(draftTitle.value.trim());
      await itemsDbApplyMutation({
        kind: "upsert",
        row: {
          id: row.id,
          title: row.title,
          updated_at: row.updated_at ?? null,
        },
      });
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await refreshAfterMutation();
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
      const row = await apiItemUpdate(id, draftTitle.value.trim());
      await itemsDbApplyMutation({
        kind: "upsert",
        row: {
          id: row.id,
          title: row.title,
          updated_at: row.updated_at ?? null,
        },
      });
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await refreshAfterMutation();
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
      await itemsDbApplyMutation({ kind: "delete", id });
      modal.value = "none";
      editId.value = null;
      modalOpen.value = false;
      await refreshAfterMutation();
    } catch (e) {
      actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  return (
    <div>
      <h1 class="mt-0 text-xl font-semibold tracking-tight">アイテム</h1>
      <p class="mb-4 text-sm text-muted-foreground">
        一覧・集計の SSOT はブラウザ内 <strong>DuckDB-WASM</strong>
        （OPFS 永続化を試行、不可時はインメモリ）。初回は Arrow 取得を WASM
        初期化と並列に進め、準備完了後に取り込みます。「サーバから再同期」で{" "}
        <code>itemsArrowBinary</code> / GraphQL 一覧に追随します。
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
          <Button type="button" look="outline" onClick$={fullResync}>
            サーバから再同期
          </Button>
        </div>
      </div>

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
            {virtPad.value.total === 0 ? (
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
                      height: `${virtPad.value.padTop}px`,
                    }}
                  />
                </tr>
                {windowRows.value.map((row) => (
                  <tr key={row.id} style={{ height: `${VIRT_ROW}px` }}>
                    <td>{row.title}</td>
                    <td>
                      <code style={{ fontSize: "0.75rem" }}>{row.id}</code>
                    </td>
                    <td class="text-muted-foreground">
                      {row.updated_at ?? "—"}
                    </td>
                    <td class="whitespace-nowrap">
                      <ItemRowActions
                        key={row.id}
                        itemId={row.id}
                        itemTitle={row.title}
                        onEdit$={openEditRow}
                        onDelete$={openDeleteRow}
                      />
                    </td>
                  </tr>
                ))}
                <tr aria-hidden="true">
                  <td
                    colSpan={4}
                    style={{
                      padding: 0,
                      border: "none",
                      height: `${virtPad.value.padBottom}px`,
                    }}
                  />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p class="mb-4 text-xs text-muted-foreground">
        表示件数（フィルタ後）{virtPad.value.total} 件 · 仮想スクロール。フォーカス復帰時に{" "}
        <code>itemsUpdatedAfter</code> / <code>itemIds</code> で DuckDB を更新し集計を再計算。
      </p>

      <Modal.Root bind:show={modalOpen} onClose$={closeModal}>
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

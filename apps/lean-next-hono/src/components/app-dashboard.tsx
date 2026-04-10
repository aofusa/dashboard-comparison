"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch, authJson, clearStoredTokens } from "@/lib/auth-fetch";
import { STORAGE_ACCESS } from "@/lib/storage-keys";
import { cn } from "@/lib/utils";

export type ItemRow = { id: string; title: string; updatedAt: string };

type PageResponse = {
  items: ItemRow[];
  total: number;
  page: number;
  pageSize: number;
};

type StatsResponse = {
  total: number;
  by_initial: { letter: string; count: number }[];
};

type IdSetResponse = { ids: string[] };

function maxUpdatedIso(items: ItemRow[]): string {
  if (items.length === 0) return new Date(0).toISOString();
  return items.reduce((a, b) => (a > b.updatedAt ? a : b.updatedAt), items[0].updatedAt);
}

async function fetchAllItems(): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const j = await authJson<PageResponse>(
      `/api/items?page=${page}&pageSize=${pageSize}`,
    );
    out.push(...j.items);
    if (j.items.length < pageSize || out.length >= j.total) break;
    page += 1;
  }
  return out;
}

export function AppDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"title" | "updatedAt">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<ItemRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ItemRow | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_ACCESS)) {
      router.replace("/login");
    }
  }, [router]);

  const itemsQuery = useQuery({
    queryKey: ["items", "all"],
    queryFn: fetchAllItems,
  });

  const statsQuery = useQuery({
    queryKey: ["items", "stats"],
    queryFn: () => authJson<StatsResponse>("/api/items/stats"),
  });

  const mergeRemote = useCallback(
    async () => {
      const items = queryClient.getQueryData<ItemRow[]>(["items", "all"]) ?? [];
      const after = maxUpdatedIso(items);
      const delta = await authJson<{ items: ItemRow[] }>(
        `/api/items?updated_after=${encodeURIComponent(after)}`,
      );
      const idSet = await authJson<IdSetResponse>("/api/items/id-set");
      const allowed = new Set(idSet.ids);
      queryClient.setQueryData<ItemRow[]>(["items", "all"], (prev) => {
        const base = prev ?? [];
        const byId = new Map(base.map((i) => [i.id, i] as const));
        for (const u of delta.items) {
          byId.set(u.id, u);
        }
        const merged = Array.from(byId.values()).filter((i) => allowed.has(i.id));
        return merged;
      });
      await queryClient.invalidateQueries({ queryKey: ["items", "stats"] });
    },
    [queryClient],
  );

  useEffect(() => {
    const onFocus = () => {
      void mergeRemote();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [mergeRemote]);

  const filtered = useMemo(() => {
    const raw = itemsQuery.data ?? [];
    const f = filter.trim().toLowerCase();
    const rows = (f
      ? raw.filter((i) => i.title.toLowerCase().includes(f))
      : raw.slice()
    ).sort((a, b) => {
      const av = sort === "title" ? a.title : a.updatedAt;
      const bv = sort === "title" ? b.title : b.updatedAt;
      const c = av.localeCompare(bv);
      return sortDir === "asc" ? c : -c;
    });
    return rows;
  }, [itemsQuery.data, filter, sort, sortDir]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  const invalidateItems = () => {
    void queryClient.invalidateQueries({ queryKey: ["items", "all"] });
    void queryClient.invalidateQueries({ queryKey: ["items", "stats"] });
  };

  const createMut = useMutation({
    mutationFn: async (title: string) => {
      await authJson<ItemRow>("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    },
    onSuccess: () => {
      setCreateOpen(false);
      setCreateTitle("");
      invalidateItems();
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      await authJson<ItemRow>(`/api/items/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    },
    onSuccess: () => {
      setEditOpen(false);
      setEditItem(null);
      invalidateItems();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/items/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      setDeleteOpen(false);
      setDeleteTarget(null);
      invalidateItems();
    },
  });

  async function handleLogout() {
    const { access } =
      typeof window !== "undefined"
        ? { access: localStorage.getItem(STORAGE_ACCESS) }
        : { access: null };
    if (access) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}` },
      }).catch(() => {});
    }
    clearStoredTokens();
    await signOut({ callbackUrl: "/" });
  }

  const stats = statsQuery.data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">ダッシュボード</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
            新規作成
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleLogout()}>
            ログアウト
          </Button>
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "outline" }), "inline-flex")}
          >
            トップへ
          </Link>
          <a
            href="/api/swagger"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "inline-flex")}
          >
            Swagger
          </a>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        ウィンドウをフォーカスすると、他タブでの変更を{" "}
        <code className="rounded bg-muted px-1 text-xs">updated_after</code> と{" "}
        <code className="rounded bg-muted px-1 text-xs">id-set</code> で同期します。
        GraphQL・Arrow・DuckDB は本構成では未提供です。
      </p>

      {stats ? (
        <div className="bg-muted/40 flex flex-wrap gap-3 rounded-lg border p-3 text-sm">
          <span className="font-medium">集計</span>
          <span>合計: {stats.total}</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">
            先頭文字:{" "}
            {stats.by_initial
              .slice(0, 12)
              .map((x) => `${JSON.stringify(x.letter)}:${x.count}`)
              .join(", ")}
            {stats.by_initial.length > 12 ? " …" : ""}
          </span>
        </div>
      ) : statsQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">集計を読み込み中…</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="filter">フィルタ</Label>
          <Input
            id="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="タイトルに含む文字列"
            className="w-56"
          />
        </div>
        <div className="space-y-1">
          <Label>ソート</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={sort === "updatedAt" ? "default" : "outline"}
              onClick={() => setSort("updatedAt")}
            >
              更新日時
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sort === "title" ? "default" : "outline"}
              onClick={() => setSort("title")}
            >
              タイトル
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? "昇順" : "降順"}
            </Button>
          </div>
        </div>
      </div>

      {itemsQuery.isError ? (
        <p className="text-destructive text-sm">
          一覧の取得に失敗しました。ログインし直してください。
        </p>
      ) : null}

      <div
        ref={parentRef}
        className="border-border h-[min(60vh,520px)] overflow-auto rounded-md border"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((v) => {
            const row = filtered[v.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                className="border-border absolute top-0 left-0 flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-sm"
                style={{
                  height: `${v.size}px`,
                  transform: `translateY(${v.start}px)`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{row.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {row.updatedAt}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditItem(row);
                      setEditTitle(row.title);
                      setEditOpen(true);
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setDeleteTarget(row);
                      setDeleteOpen(true);
                    }}
                  >
                    削除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        仮想スクロール: {filtered.length} 件表示
        {itemsQuery.isFetching ? "（更新中）" : ""}
      </p>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>アイテムを作成</DialogTitle>
            <DialogDescription>タイトルを入力してください。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ct">タイトル</Label>
            <Input
              id="ct"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
            />
          </div>
          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              onClick={() => createMut.mutate(createTitle.trim())}
              disabled={!createTitle.trim() || createMut.isPending}
            >
              作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>アイテムを更新</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="et">タイトル</Label>
            <Input
              id="et"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </div>
          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              onClick={() =>
                editItem &&
                updateMut.mutate({
                  id: editItem.id,
                  title: editTitle.trim(),
                })
              }
              disabled={!editItem || !editTitle.trim() || updateMut.isPending}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>削除の確認</DialogTitle>
            <DialogDescription>
              「{deleteTarget?.title ?? ""}」を削除しますか？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                deleteTarget && deleteMut.mutate(deleteTarget.id)
              }
              disabled={!deleteTarget || deleteMut.isPending}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

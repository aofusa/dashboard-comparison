"use client";

import { useQuery } from "@tanstack/react-query";

import { client } from "@/lib/api";

type HealthJson = { status: string; service: string };

/** OpenAPIHono 由来の `hc<AppType>` が現行型定義で `unknown` になるため、ヘルスだけ明示 */
type HealthRpc = {
  health: { $get: (args?: object) => Promise<Response> };
};

export function ApiHealth() {
  const q = useQuery({
    queryKey: ["api", "health"],
    queryFn: async (): Promise<HealthJson> => {
      const res = await (client() as HealthRpc).health.$get();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  if (q.isPending) {
    return <p className="text-sm text-neutral-500">API health: 読み込み中…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-sm text-red-600">
        API health: エラー（{q.error.message}）
      </p>
    );
  }
  return (
    <p className="text-sm text-neutral-700 dark:text-neutral-300">
      API health: <code>{q.data.status}</code> / {q.data.service}
    </p>
  );
}

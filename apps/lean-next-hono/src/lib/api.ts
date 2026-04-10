"use client";

import { hc } from "hono/client";

import type { AppType } from "@/lib/hono-app";

/**
 * 同一オリジン上の Hono API へ型付きでアクセス（仕様: `@/lib/api`）。
 * クライアントコンポーネント内でのみ使用すること。
 */
export function client() {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/api`
      : `${process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"}/api`;
  return hc<AppType>(base);
}

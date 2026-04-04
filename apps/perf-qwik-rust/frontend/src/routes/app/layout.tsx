import { component$, Slot, useVisibleTask$ } from "@builder.io/qwik";
import { Link, useLocation, useNavigate } from "@builder.io/qwik-city";
import { Button } from "~/components/ui";
import { getAccessToken, logoutRequest } from "~/lib/auth";

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();

  // クライアントのみ: localStorage の Access を参照して未ログインを弾く
  // eslint-disable-next-line qwik/no-use-visible-task -- SSR ではトークンを持たない
  useVisibleTask$(({ track }) => {
    track(() => loc.url.pathname);
    if (!getAccessToken()) {
      void nav("/login/");
    }
  });

  return (
    <div class="flex min-h-screen flex-col bg-background text-foreground">
      <header class="flex flex-none items-center justify-between gap-4 border-b border-border px-5 py-3">
        <span class="text-sm font-semibold tracking-tight">
          perf · ダッシュボード
        </span>
        <nav class="flex items-center gap-3">
          <Link
            href="/app/"
            class="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            アイテム
          </Link>
          <Button
            type="button"
            look="outline"
            size="sm"
            onClick$={async () => {
              await logoutRequest();
              await nav("/login/");
            }}
          >
            ログアウト
          </Button>
        </nav>
      </header>
      <main class="shell-main">
        <Slot />
      </main>
    </div>
  );
});

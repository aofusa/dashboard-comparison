import { component$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";

export default component$(() => {
  const btnPrimary =
    "inline-flex h-12 items-center justify-center rounded-sm border border-border bg-primary px-4 text-base font-medium text-primary-foreground shadow-sm transition-all duration-100 hover:bg-primary/90 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden";
  const btnOutline =
    "inline-flex h-12 items-center justify-center rounded-sm border border-border bg-background px-4 text-base font-medium text-foreground shadow-sm transition-all duration-100 hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden";
  return (
    <div class="shell-main">
      <div class="mx-auto my-8 max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-md">
        <h1 class="mt-0 text-2xl font-semibold tracking-tight">
          perf-qwik-rust
        </h1>
        <p class="text-sm text-muted-foreground">
          UI は lowspec-qwik-rust フロントを流用。バックエンドは perf（MySQL + DynamoDB 互換）、
          <code>/api</code> は Vite プロキシ（<code>frontend/.env</code> の{" "}
          <code>BACKEND_URL</code> / <code>BACKEND_PORT</code> で接続先を指定）。
        </p>
        <p class="mt-4 flex flex-wrap gap-3">
          <Link href="/login/" class={btnPrimary}>
            ログイン
          </Link>
          <Link href="/app/" class={btnOutline}>
            ダッシュボード
          </Link>
        </p>
        <p class="hint mt-4">
          開発: バックエンドを起動し、<code>.env.example</code> を参考に{" "}
          <code>BACKEND_*</code> をバックエンドの listen に合わせてから{" "}
          <code>npm start</code>（既定は <code>127.0.0.1:8080</code>）。
        </p>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "perf-qwik-rust",
  meta: [
    {
      name: "description",
      content: "perf Qwik + Rust dashboard (lowspec UI reuse)",
    },
  ],
};

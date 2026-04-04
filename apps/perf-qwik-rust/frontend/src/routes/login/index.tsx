import { $, component$, useSignal } from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { Button, Input, Label } from "~/components/ui";
import { loginRequest, setTokens } from "~/lib/auth";

export default component$(() => {
  const nav = useNavigate();
  const email = useSignal("dev@example.com");
  const password = useSignal("devpass");
  const error = useSignal("");
  const busy = useSignal(false);

  const onSubmit = $(async () => {
    error.value = "";
    busy.value = true;
    try {
      const res = await loginRequest(email.value, password.value);
      setTokens(res.token, res.refresh_token ?? "");
      await nav("/app/");
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  });

  return (
    <div class="flex min-h-[60vh] items-center justify-center px-4 py-8">
      <div class="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-md">
        <h1 class="mt-0 text-xl font-semibold tracking-tight">ログイン</h1>
        {error.value ? (
          <div
            class="mt-3 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
            role="alert"
          >
            {error.value}
          </div>
        ) : null}
        <form
          preventdefault:submit
          onSubmit$={onSubmit}
          class="mt-4 flex flex-col gap-4"
        >
          <div class="flex flex-col gap-2">
            <Label for="email">メール</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              bind:value={email}
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="pw">パスワード</Label>
            <Input
              id="pw"
              type="password"
              autoComplete="current-password"
              bind:value={password}
            />
          </div>
          <Button type="submit" disabled={busy.value}>
            {busy.value ? "送信中…" : "ログイン"}
          </Button>
        </form>
        <p class="mt-4 text-sm text-muted-foreground">
          <Link href="/" class="text-primary underline-offset-4 hover:underline">
            トップへ
          </Link>
        </p>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "ログイン | perf-qwik-rust",
};

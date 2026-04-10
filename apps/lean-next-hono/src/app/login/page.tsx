"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { getCsrfToken, signIn } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";

import { persistTokens } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";

  const [email, setEmail] = useState("dev@example.com");
  const [password, setPassword] = useState("devpass");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Auth.js の二重送信クッキーを先に付与（マウント直後の signIn で MissingCSRF になるのを防ぐ） */
  useEffect(() => {
    void getCsrfToken();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        setError("メールまたはパスワードが正しくありません。");
        return;
      }
      const tokens = (await loginRes.json()) as {
        token: string;
        refresh_token: string;
        expires_in: number;
      };
      persistTokens(tokens);

      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("セッションの確立に失敗しました。再度お試しください。");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>
            まず <code className="text-xs">POST /api/auth/login</code> で
            Access/Refresh を取得し localStorage に保存します。続けて Auth.js
            セッションも確立します（保護 API は Bearer 優先・Cookie
            フォールバック）。開発ユーザー:{" "}
            <code className="text-xs">npm run db:seed</code> 後{" "}
            <code className="text-xs">dev@example.com</code> /{" "}
            <code className="text-xs">devpass</code>
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">メール</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "送信中…" : "ログイン"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          読み込み中…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ApiHealth } from "@/components/api-health";
import { buttonVariants } from "@/components/ui/button-variants";
import { getCachedPackageInfo } from "@/lib/get-cached-package-info";
import { cn } from "@/lib/utils";

export default async function Home() {
  const session = await auth();
  if (session) {
    redirect("/app");
  }

  const pkg = await getCachedPackageInfo();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {pkg.name}{" "}
          <span className="text-muted-foreground text-lg font-normal">
            v{pkg.version}
          </span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Next.js + Hono + Drizzle + Auth.js（仕様 v4.1.1）。未ログイン時はログインへ進んでください。
        </p>
        <ApiHealth />
        <p className="text-muted-foreground text-xs">
          <code>package.json</code> は{" "}
          <code className="rounded bg-muted px-1">unstable_cache</code>{" "}
          で参照（例）。
        </p>
        <Link href="/login" className={cn(buttonVariants())}>
          ログイン
        </Link>
      </div>
    </div>
  );
}

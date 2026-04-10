import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AppSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/app");
  }
  return <>{children}</>;
}

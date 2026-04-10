import type { Metadata } from "next";
import localFont from "next/font/local";

import { QueryProvider } from "@/components/query-provider";
import { SessionProvider } from "@/components/session-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "lean-next-hono",
  description: "Next.js 14 + Hono + Drizzle + Auth.js（lean-next-hono-v4.1.1）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={cn(geistSans.variable)}>
      <body className="min-h-screen antialiased font-sans">
        <SessionProvider>
          <QueryProvider>{children}</QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

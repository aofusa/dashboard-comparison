import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import { db } from "@/db";
import { account, session, user, verificationToken } from "@/db/schema";

/**
 * Credentials プロバイダは Auth.js の制約により **database セッションと併用不可**のため
 * `strategy: "jwt"` とする。ユーザー行は MySQL の `user` 表（`password_hash`）で管理。
 * DrizzleAdapter は OAuth 連携・将来の DB セッション用に接続。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  adapter: DrizzleAdapter(db, {
    usersTable: user,
    accountsTable: account,
    sessionsTable: session,
    verificationTokensTable: verificationToken,
  }),
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) {
          return null;
        }
        const rows = await db.select().from(user).where(eq(user.email, email));
        const u = rows[0];
        if (!u?.passwordHash) {
          return null;
        }
        const ok = await compare(password, u.passwordHash);
        if (!ok) {
          return null;
        }
        return {
          id: u.id,
          email: u.email ?? undefined,
          name: u.name ?? undefined,
          image: u.image ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user: u }) {
      if (u) {
        token.sub = u.id;
        token.email = u.email;
        token.name = u.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
      }
      return session;
    },
  },
});

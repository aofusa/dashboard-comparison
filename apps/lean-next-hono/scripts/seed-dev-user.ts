/**
 * 開発用ユーザー投入: dev@example.com / devpass（bcrypt ハッシュ）
 * 事前: MySQL 起動・`DATABASE_URL`・`npm run db:push`
 */
import "dotenv/config";

import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "../src/db/schema";
import { item, user } from "../src/db/schema";

const SAMPLE_TITLES = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliett",
  "Kilo",
  "Lima",
] as const;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL が未設定です。");
  }

  const pool = mysql.createPool(url);
  const db = drizzle(pool, { schema, mode: "default" });

  const email = "dev@example.com";
  const plain = "devpass";
  const passwordHash = await hash(plain, 10);

  const existing = await db.select().from(user).where(eq(user.email, email));
  const row = existing[0];

  let userId: string;

  if (row) {
    userId = row.id;
    const same = await compare(plain, row.passwordHash ?? "");
    if (same) {
      console.log("既に dev@example.com が存在し、パスワードは一致しています。");
    } else {
      await db
        .update(user)
        .set({ passwordHash })
        .where(eq(user.id, row.id));
      console.log("dev@example.com の password_hash を更新しました。");
    }
  } else {
    userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      email,
      name: "Dev User",
      passwordHash,
    });
    console.log("dev@example.com を作成しました。");
  }

  const existingItems = await db
    .select()
    .from(item)
    .where(eq(item.userId, userId));
  if (existingItems.length === 0) {
    await db.insert(item).values(
      SAMPLE_TITLES.map((title) => ({ userId, title })),
    );
    console.log(`サンプル item を ${SAMPLE_TITLES.length} 件投入しました。`);
  } else {
    console.log(
      `item は既に ${existingItems.length} 件あるためシードをスキップしました。`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

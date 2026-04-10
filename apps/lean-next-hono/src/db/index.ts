import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL が未設定です。`cp .env.example .env` のうえ MySQL を起動し、接続文字列を設定してください（README 参照）。",
    );
  }
  return url;
}

const pool = mysql.createPool(requireDatabaseUrl());

export const db = drizzle(pool, { schema, mode: "default" });

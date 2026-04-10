/**
 * Auth.js / @auth/drizzle-adapter の MySQL スキーマ（公式 defineTables と整合）+
 * Credentials 用 `password_hash`（OAuth ユーザは null）。
 */
import {
  index,
  int,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const user = mysqlTable("user", {
  id: varchar("id", { length: 255 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }).unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", fsp: 3 }),
  image: varchar("image", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }),
});

export const account = mysqlTable(
  "account",
  {
    userId: varchar("userId", { length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("providerAccountId", {
      length: 255,
    }).notNull(),
    refresh_token: varchar("refresh_token", { length: 255 }),
    access_token: varchar("access_token", { length: 255 }),
    expires_at: int("expires_at"),
    token_type: varchar("token_type", { length: 255 }),
    scope: varchar("scope", { length: 255 }),
    id_token: varchar("id_token", { length: 2048 }),
    session_state: varchar("session_state", { length: 255 }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const session = mysqlTable("session", {
  sessionToken: varchar("sessionToken", { length: 255 }).primaryKey(),
  userId: varchar("userId", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationToken = mysqlTable(
  "verificationToken",
  {
    identifier: varchar("identifier", { length: 255 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

/** ダッシュボード用アイテム（MySQL 集約・性能テスト整合 REST） */
export const item = mysqlTable(
  "item",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userUpdatedIdx: index("item_user_updated_idx").on(t.userId, t.updatedAt),
    userIdx: index("item_user_idx").on(t.userId),
  }),
);

/** REST Refresh（生トークンは保存せず SHA-256 hex のみ） */
export const refreshToken = mysqlTable("refresh_token", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date", fsp: 3 }).notNull(),
});

/**
 * Drizzle テーブルから Zod スキーマを生成（仕様: drizzle-zod）
 */
import { createInsertSchema } from "drizzle-zod";

import { user } from "./schema";

export const insertUserSchema = createInsertSchema(user);

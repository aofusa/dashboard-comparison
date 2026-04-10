import { createHash, randomBytes } from "crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { refreshToken } from "@/db/schema";

import { accessExpiresInSeconds, signAccessToken } from "./jwt-tokens";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newRefreshRaw(): string {
  return randomBytes(32).toString("hex");
}

function refreshExpDays(): number {
  const n = Number(process.env.JWT_REFRESH_EXP_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

export async function insertRefreshToken(
  userId: string,
  rawToken: string,
): Promise<Date> {
  const expiresAt = new Date(
    Date.now() + refreshExpDays() * 24 * 60 * 60 * 1000,
  );
  await db.insert(refreshToken).values({
    userId,
    tokenHash: sha256Hex(rawToken),
    expiresAt,
  });
  return expiresAt;
}

export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ userId: string } | null> {
  const hash = sha256Hex(rawToken);
  const rows = await db
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, hash));
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(refreshToken).where(eq(refreshToken.id, row.id));
    return null;
  }
  await db.delete(refreshToken).where(eq(refreshToken.id, row.id));
  return { userId: row.userId };
}

export async function revokeAllRefreshForUser(userId: string): Promise<void> {
  await db.delete(refreshToken).where(eq(refreshToken.userId, userId));
}

/** ログイン／リフレッシュ成功時の JSON 用 */
export async function issueTokenBundle(userId: string, email?: string | null) {
  const access = await signAccessToken(userId, email);
  const refresh = newRefreshRaw();
  await insertRefreshToken(userId, refresh);
  return {
    token: access,
    refresh_token: refresh,
    expires_in: accessExpiresInSeconds(),
  };
}

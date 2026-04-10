import { getToken } from "next-auth/jwt";
import type { Context } from "hono";

import { verifyAccessToken } from "@/lib/jwt-tokens";

export async function resolveUserIdFromRequest(
  c: Context,
): Promise<string | null> {
  const auth = c.req.header("Authorization");
  const m = auth?.match(/^Bearer\s+(\S+)/i);
  if (m?.[1]) {
    try {
      const { sub } = await verifyAccessToken(m[1].trim());
      return sub;
    } catch {
      return null;
    }
  }
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const token = await getToken({ req: c.req.raw, secret });
    const sub = token?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

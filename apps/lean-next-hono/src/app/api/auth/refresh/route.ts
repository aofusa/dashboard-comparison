import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { user } from "@/db/schema";
import { issueTokenBundle, rotateRefreshToken } from "@/lib/rest-auth";

export async function POST(req: Request) {
  let body: { refresh_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = String(body.refresh_token ?? "");
  if (!raw) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rotated = await rotateRefreshToken(raw);
  if (!rotated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db.select().from(user).where(eq(user.id, rotated.userId));
  const u = rows[0];
  const bundle = await issueTokenBundle(rotated.userId, u?.email ?? null);
  return NextResponse.json(bundle);
}

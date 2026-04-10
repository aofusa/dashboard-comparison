import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { user } from "@/db/schema";
import { issueTokenBundle } from "@/lib/rest-auth";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db.select().from(user).where(eq(user.email, email));
  const u = rows[0];
  if (!u?.passwordHash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await compare(password, u.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const bundle = await issueTokenBundle(u.id, u.email);
  return NextResponse.json(bundle);
}

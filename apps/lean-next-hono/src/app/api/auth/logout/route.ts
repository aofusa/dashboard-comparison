import { NextResponse } from "next/server";

import { verifyAccessToken } from "@/lib/jwt-tokens";
import { revokeAllRefreshForUser } from "@/lib/rest-auth";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const m = auth?.match(/^Bearer\s+(\S+)/i);
  if (!m?.[1]) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { sub } = await verifyAccessToken(m[1].trim());
    await revokeAllRefreshForUser(sub);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

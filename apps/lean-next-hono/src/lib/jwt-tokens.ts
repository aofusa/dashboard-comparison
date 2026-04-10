import * as jose from "jose";

function secretBytes(): Uint8Array {
  const s =
    process.env.JWT_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!s) {
    throw new Error(
      "JWT_SECRET / AUTH_SECRET / NEXTAUTH_SECRET のいずれかが必要です。",
    );
  }
  return new TextEncoder().encode(s);
}

function accessExpMinutes(): number {
  const n = Number(process.env.JWT_ACCESS_EXP_MINUTES ?? 15);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function accessExpiresInSeconds(): number {
  return accessExpMinutes() * 60;
}

export async function signAccessToken(
  userId: string,
  email?: string | null,
): Promise<string> {
  return new jose
    .SignJWT({ email: email ?? undefined })
    .setSubject(userId)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${accessExpMinutes()}m`)
    .sign(secretBytes());
}

export async function verifyAccessToken(
  token: string,
): Promise<{ sub: string; email?: string }> {
  const { payload } = await jose.jwtVerify(token, secretBytes());
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("invalid token: no sub");
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

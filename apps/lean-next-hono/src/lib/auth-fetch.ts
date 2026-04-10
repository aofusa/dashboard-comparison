import { STORAGE_ACCESS, STORAGE_REFRESH } from "@/lib/storage-keys";

type TokenPayload = {
  token: string;
  refresh_token: string;
  expires_in: number;
};

function readTokens(): { access: string | null; refresh: string | null } {
  if (typeof window === "undefined") {
    return { access: null, refresh: null };
  }
  return {
    access: localStorage.getItem(STORAGE_ACCESS),
    refresh: localStorage.getItem(STORAGE_REFRESH),
  };
}

export function persistTokens(p: TokenPayload) {
  localStorage.setItem(STORAGE_ACCESS, p.token);
  localStorage.setItem(STORAGE_REFRESH, p.refresh_token);
}

export function clearStoredTokens() {
  localStorage.removeItem(STORAGE_ACCESS);
  localStorage.removeItem(STORAGE_REFRESH);
}

async function refreshTokens(): Promise<boolean> {
  const { refresh } = readTokens();
  if (!refresh) return false;
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    credentials: "include",
  });
  if (!res.ok) return false;
  const body = (await res.json()) as TokenPayload;
  persistTokens(body);
  return true;
}

/** Bearer 付き fetch。401 時に 1 回だけ refresh を試す。 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const { access } = readTokens();
  const headers = new Headers(init.headers);
  if (access) headers.set("Authorization", `Bearer ${access}`);

  const url = input.startsWith("http")
    ? input
    : `${typeof window !== "undefined" ? window.location.origin : ""}${input}`;

  let res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401) {
    const ok = await refreshTokens();
    if (ok) {
      const { access: next } = readTokens();
      if (next) headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(url, {
        ...init,
        headers,
        credentials: "include",
      });
    }
  }
  return res;
}

export async function authJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(input, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

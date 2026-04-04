/**
 * perf-qwik-rust: Access + Refresh（localStorage）と tower-sessions Cookie。
 * 認証 API は `POST /api/graphql` の Mutation のみ（lowspec とキー接頭辞のみ異なる）。
 */
const ACCESS = "perf_access_token";
const REFRESH = "perf_refresh_token";

const GQL_PATH = "/api/graphql";

export function getAccessToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACCESS);
}

export function getRefreshToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(REFRESH);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS, access);
  localStorage.setItem(REFRESH, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export type LoginResponse = {
  token: string;
  refresh_token: string;
  expires_in: number;
};

async function gqlLoginShape(
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
): Promise<LoginResponse> {
  const res = await fetch(GQL_PATH, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ query, variables, operationName }),
  });
  const text = await res.text();
  let j: {
    data?: {
      authLogin?: {
        token: string;
        refreshToken: string;
        expiresIn: number;
      };
      authRefresh?: {
        token: string;
        refreshToken: string;
        expiresIn: number;
      };
    };
    errors?: { message: string }[];
  };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new Error(text || `ログイン失敗 (${res.status})`);
  }
  if (j.errors?.length) {
    throw new Error(j.errors[0].message || `HTTP ${res.status}`);
  }
  const p = j.data?.authLogin ?? j.data?.authRefresh;
  if (!p) {
    throw new Error("GraphQL: no auth payload");
  }
  return {
    token: p.token,
    refresh_token: p.refreshToken,
    expires_in: Number(p.expiresIn),
  };
}

export async function loginRequest(
  email: string,
  password: string,
): Promise<LoginResponse> {
  return gqlLoginShape(
    `
    mutation AuthLogin($email: String!, $password: String!) {
      authLogin(email: $email, password: $password) {
        token
        refreshToken
        expiresIn
      }
    }`,
    { email, password },
    "AuthLogin",
  );
}

export async function refreshRequest(): Promise<LoginResponse | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
    return await gqlLoginShape(
      `
      mutation AuthRefresh($refreshToken: String!) {
        authRefresh(refreshToken: $refreshToken) {
          token
          refreshToken
          expiresIn
        }
      }`,
      { refreshToken: rt },
      "AuthRefresh",
    );
  } catch {
    clearTokens();
    return null;
  }
}

export async function logoutRequest(): Promise<void> {
  try {
    const headers: HeadersInit = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    const token = getAccessToken();
    if (token) {
      (headers as Record<string, string>)["Authorization"] =
        `Bearer ${token}`;
    }
    await fetch(GQL_PATH, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        query: `mutation AuthLogout { authLogout { ok } }`,
        operationName: "AuthLogout",
      }),
    });
  } finally {
    clearTokens();
  }
}

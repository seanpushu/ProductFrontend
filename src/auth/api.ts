// User Service client. Access / ID tokens are kept in memory only; the refresh
// token lives in an HttpOnly cookie the browser sends with credentials:"include".
// Never put secrets in VITE_* variables: they are compiled into public JS.

export type Profile = {
  id: string;
  email: string;
  status: string;
  ai_quota_limit: number;
  ai_usage_count: number;
};

export type Tokens = {
  access_token: string;
  id_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

// Accounts are shown only when the build says a User Service is reachable
// (local dev: VITE_AUTH_BASE_URL set; production: VITE_AUTH_ENABLED=true once
// CloudFront routes the auth paths). Otherwise the catalog stays read-only.
export function authEnabled(): boolean {
  return Boolean(import.meta.env.VITE_AUTH_BASE_URL) || import.meta.env.VITE_AUTH_ENABLED === "true";
}

export function authBaseUrl(): string {
  // Empty string = same origin (production: CloudFront routes auth paths to the User Service).
  return (import.meta.env.VITE_AUTH_BASE_URL ?? "").replace(/\/+$/, "");
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  let body: { code?: string; message?: string } & Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. proxy error page)
  }
  if (!res.ok) {
    throw new AuthApiError(body.message || `Request failed (HTTP ${res.status})`, res.status, body.code || "HTTP_ERROR");
  }
  return body as T;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${authBaseUrl()}${path}`, { ...init, credentials: "include", cache: "no-store" });
  } catch {
    throw new AuthApiError("Could not reach the sign-in service", 0, "NETWORK");
  }
}

// One CSRF token per page load. The server sets the matching HttpOnly cookie;
// fetching a new token for every request would race (the cookie is replaced
// while an earlier request still carries the old header value).
let csrfPromise: Promise<string> | null = null;

function csrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = send("/auth/csrf", { method: "GET" })
      .then((res) => parse<{ csrf_token: string }>(res))
      .then((b) => b.csrf_token)
      .catch((err) => {
        csrfPromise = null; // allow a later retry
        throw err;
      });
  }
  return csrfPromise;
}

export function resetCsrfForTests(): void {
  csrfPromise = null;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const attempt = async () =>
    send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await attempt();
  if (res.status === 403) {
    // CSRF cookie may have expired or the server restarted: get a fresh token once.
    const copy = res.clone();
    const code = await copy.json().then((b: { code?: string }) => b.code).catch(() => undefined);
    if (code === "CSRF_FAILED") {
      csrfPromise = null;
      res = await attempt();
    }
  }
  return parse<T>(res);
}

export const authApi = {
  register: (email: string, password: string) =>
    post<{ user_id: string; status: string; next_step: "CONFIRM_EMAIL" | "LOGIN" }>("/register", { email, password }),
  confirm: (email: string, code: string) => post<{ status: string; next_step: string }>("/confirm", { email, code }),
  resend: (email: string) => post<{ status: string }>("/confirm/resend", { email }),
  login: (email: string, password: string) => post<Tokens>("/login", { email, password }),
  refresh: () => post<Tokens>("/refresh"),
  logout: () => post<void>("/logout"),
  me: async (accessToken: string) =>
    parse<Profile>(await send("/me", { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } })),
};

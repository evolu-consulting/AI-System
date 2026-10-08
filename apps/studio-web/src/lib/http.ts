// HUB-FR-72 · H4a-R14 · fetch wrapper (mẫu chat-web, copy-then-own): JSON, ApiError{status,code,details}, Bearer,
// Accept-Language; 401 ngoài `/auth/*` → refresh đúng 1 lần rồi gửi lại (plan-frontend D5). `/auth/*` đi qua AUTH_BASE (D4).
import { AUTH_BASE } from "./env";

/** CR-053 · = `X_APP_HEADER` (`@ai/contracts` auth): app báo mình khi gọi `/auth/*` (không kéo contract vào bundle). */
const X_APP_HEADER = "X-App";

export type ApiErrorCode = string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AuthHooks = {
  getToken(): string | null;
  /** Token mới, hoặc `null` nếu hết phiên. `stale` = token vừa bị 401. Ném lỗi mạng khi không tới được máy chủ. */
  refresh(stale: string | null): Promise<string | null>;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

let hooks: AuthHooks | null = null;
let language: string | null = null;

export function setAuthHooks(next: AuthHooks | null): void {
  hooks = next;
}

/** Ngôn ngữ UI gửi qua `Accept-Language`. */
export function setRequestLanguage(lang: string | null): void {
  language = lang;
}

/** `/auth` và `/auth/*`: 401 ở đây là kết quả (sai mật khẩu, hết phiên), không vòng refresh. */
export function isAuthPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return p === "/auth" || p.startsWith("/auth/");
}

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  let url = isAuthPath(path) ? `${AUTH_BASE}${path}` : path;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") sp.set(k, String(v));
    }
    const s = sp.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };

async function parseError(res: Response): Promise<ApiError> {
  try {
    const e = ((await res.json()) as ErrorBody).error;
    if (e && typeof e.code === "string") {
      const message = typeof e.message === "string" ? e.message : res.statusText;
      return new ApiError(res.status, e.code, message, e.details);
    }
  } catch {
    // thân không phải JSON (vd 502/504 từ proxy)
  }
  return new ApiError(res.status, "HTTP_ERROR", res.statusText || `HTTP ${res.status}`);
}

async function exec(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (language) headers["Accept-Language"] = language;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  Object.assign(headers, opts.headers);
  // CR-053: `/auth/*` báo app ⇒ admin-api dùng cookie phiên riêng `ai_rt_studio`.
  if (isAuthPath(path)) headers[X_APP_HEADER] = "studio";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Network error");
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

async function toJson<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Không gắn Bearer, không vòng refresh: login, totp/verify, refresh, logout. */
export async function sendPublic<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return toJson<T>(await exec(path, opts, null));
}

/** Kèm Bearer; 401 (mọi mã) ngoài `/auth/*` → refresh một lần rồi gửi lại; vẫn lỗi → ném lỗi lần 2. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = hooks?.getToken() ?? null;
  try {
    return await toJson<T>(await exec(path, opts, token));
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !hooks || isAuthPath(path)) throw err;
    const fresh = await hooks.refresh(token);
    if (!fresh) throw err;
    return toJson<T>(await exec(path, opts, fresh));
  }
}

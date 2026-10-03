// CHAT-AC-03 · fetch wrapper (chép admin-web): JSON, ApiError, Bearer, Accept-Language;
// 401 bất kỳ mã từ endpoint Hub (C1: `AUTH_EXPIRED`) → refresh đúng 1 lần rồi gửi lại. `/auth/*` không vòng refresh (plan Q-401).
import type { ChatErrorCode } from "@ai/contracts/chat";

/** Mã lỗi `/auth/*` (giữ mã Admin, plan Q-401). */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "REFRESH_SUPERSEDED"
  | "UNAUTHORIZED"
  | "ACCOUNT_LOCKED"
  | "TEMP_LOCKED";
export type ApiErrorCode = ChatErrorCode | AuthErrorCode | "NETWORK_ERROR" | "HTTP_ERROR";

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
  /** Trả token mới, hoặc `null` nếu hết phiên. `stale` = token vừa bị 401. Ném lỗi mạng để báo Hub/Auth không tới được. */
  refresh(stale: string | null): Promise<string | null>;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

let hooks: AuthHooks | null = null;
let language: string | null = null;

export function setAuthHooks(next: AuthHooks | null): void {
  hooks = next;
}

/** Ngôn ngữ UI gửi qua `Accept-Language` (nối từ i18n khi đổi ngôn ngữ). */
export function setRequestLanguage(lang: string | null): void {
  language = lang;
}

/** `/auth` và `/auth/*`: lỗi 401 ở đây là kết quả, không phải token hết hạn. */
export function isAuthPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return p === "/auth" || p.startsWith("/auth/");
}

function withQuery(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };

async function parseError(res: Response): Promise<ApiError> {
  try {
    const e = ((await res.json()) as ErrorBody).error;
    if (e && typeof e.code === "string") {
      const message = typeof e.message === "string" ? e.message : res.statusText;
      return new ApiError(res.status, e.code as ApiErrorCode, message, e.details);
    }
  } catch {
    // thân không phải JSON (vd 502/504 từ proxy)
  }
  return new ApiError(res.status, "HTTP_ERROR", res.statusText || `HTTP ${res.status}`);
}

async function execRaw(
  path: string,
  opts: RequestOptions,
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (language) headers["Accept-Language"] = language;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  Object.assign(headers, opts.headers);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), {
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
  return (await res.json()) as T;
}

/** Request không gắn Bearer, không bao giờ vòng refresh: login, refresh, logout. */
export async function sendPublic<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return toJson<T>(await execRaw(path, opts, null));
}

/** Gửi kèm Bearer; 401 (mọi mã) ngoài `/auth/*` → refresh một lần rồi gửi lại; vẫn lỗi → ném lỗi lần 2. */
export async function apiResponse(path: string, opts: RequestOptions = {}): Promise<Response> {
  const token = hooks?.getToken() ?? null;
  try {
    return await execRaw(path, opts, token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !hooks || isAuthPath(path)) throw err;
    const fresh = await hooks.refresh(token);
    if (!fresh) throw err;
    return execRaw(path, opts, fresh);
  }
}

/** Như `apiResponse` nhưng đọc JSON (204 → `undefined`). */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return toJson<T>(await apiResponse(path, opts));
}

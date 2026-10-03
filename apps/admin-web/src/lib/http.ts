// ADM-FR-01 · fetch wrapper: JSON, ApiError, gắn Bearer, 401 UNAUTHORIZED → refresh rồi thử lại đúng 1 lần.
import type { ErrorCode } from "@ai/contracts";

export type ApiErrorCode = ErrorCode | "NETWORK_ERROR" | "HTTP_ERROR";

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
  /** Trả token mới, hoặc `null` nếu hết phiên. `stale` = token vừa bị 401. */
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

export function setAuthHooks(next: AuthHooks | null): void {
  hooks = next;
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
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
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

async function exec<T>(path: string, opts: RequestOptions, token: string | null): Promise<T> {
  const res = await execRaw(path, opts, token);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Request không xác thực: login, refresh, change-password (không bao giờ vòng refresh). */
export function sendPublic<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return exec<T>(path, opts, null);
}

/** Request đã xác thực; gặp 401 `UNAUTHORIZED` thì refresh một lần rồi gửi lại. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = hooks?.getToken() ?? null;
  try {
    return await exec<T>(path, opts, token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "UNAUTHORIZED" || !hooks) throw err;
    const fresh = await hooks.refresh(token);
    if (!fresh) throw err;
    return exec<T>(path, opts, fresh);
  }
}

/** Như `api` nhưng trả `Response` thô (tải file: CSV, JSON export); cùng quy tắc Bearer + refresh 1 lần. */
export async function apiResponse(path: string, opts: RequestOptions = {}): Promise<Response> {
  const token = hooks?.getToken() ?? null;
  try {
    return await execRaw(path, opts, token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "UNAUTHORIZED" || !hooks) throw err;
    const fresh = await hooks.refresh(token);
    if (!fresh) throw err;
    return execRaw(path, opts, fresh);
  }
}

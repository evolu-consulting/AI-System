/** One way to call the API: same-origin /api (proxied), session cookie, errors as ApiError with the server's words. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function toLogin() {
  const p = window.location.pathname;
  if (p !== "/login") window.location.assign(`/login?next=${encodeURIComponent(p + window.location.search)}`);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, { credentials: "include", ...init });
  if (r.status === 401 && !path.startsWith("/auth/")) toLogin();
  if (!r.ok) {
    const body = await r.text();
    let detail: unknown;
    try { detail = JSON.parse(body)?.detail; } catch { /* not json */ }
    throw new ApiError(r.status, typeof detail === "string" ? detail : `Lỗi ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const send = (body: unknown, method = "POST"): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function errText(e: unknown): string {
  if (e instanceof TypeError) return "Không kết nối được máy chủ. Thử lại sau.";
  return e instanceof Error ? e.message : String(e);
}

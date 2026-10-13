// HUB-FR-66 · AC-H4b2-02 · spec H4b2 §3 A (check) · plan H4b2 §2.2, D8, D13 — luật thuần "Kiểm tra key" / "Kiểm tra lại":
// bảng hãng (endpoint liệt kê model, Q3), vendor `fake` trong tiến trình, che key, thông điệp lỗi ≤ 500, kết quả contract.
import type { ProviderCheckResult } from "@ai/contracts/studio";

export const CHECK_TIMEOUT_MS = 10_000;
const MESSAGE_MAX = 500;
/** Cắt thân lỗi trước khi che (thông điệp chỉ giữ 500 ký tự; tránh quét chuỗi rất dài). */
const SCAN_MAX = 4_000;
const MIN_KEY_RUN = 8;
const KEY_LIKE = /(sk-|sk_|AIza)[A-Za-z0-9_-]{6,}/g;
const MASK = "***";

export type CheckHit = { status: number; body: string } | "timeout" | "network";
type VendorReq = { base: string; path: string; headers: (key: string) => Record<string, string> };

const VENDORS: Record<string, VendorReq> = {
  anthropic: {
    base: "https://api.anthropic.com",
    path: "/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  openai: {
    base: "https://api.openai.com",
    path: "/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  google: {
    base: "https://generativelanguage.googleapis.com",
    path: "/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
};

/** Bảng hãng (Q3); null = unsupported (`fake` kiểm bằng `fakeCheck`, `dify`/lạ không hỗ trợ). Key KHÔNG ở URL. */
export function vendorCheckRequest(
  vendor: string,
  baseUrl: string | null,
  key: string,
): { url: string; headers: Record<string, string> } | null {
  const v = Object.hasOwn(VENDORS, vendor) ? VENDORS[vendor] : undefined;
  if (!v) return null;
  const base = (baseUrl ?? v.base).replace(/\/+$/, "");
  return { url: `${base}${v.path}`, headers: v.headers(key) };
}

/** Vendor `fake`: key bắt đầu `fake-ok` ⇒ 200; khác ⇒ 401 `invalid x-api-key (fake)`. Không gọi mạng. */
export function fakeCheck(key: string): CheckHit {
  if (key.startsWith("fake-ok")) return { status: 200, body: "{}" };
  return { status: 401, body: JSON.stringify({ error: { message: "invalid x-api-key (fake)" } }) };
}

/** Độ dài đoạn dài nhất bắt đầu tại `i` của `text` là chuỗi con của `key`. */
function keyRunAt(text: string, i: number, key: string): number {
  let len = 0;
  while (i + len < text.length && key.includes(text.slice(i, i + len + 1))) len++;
  return len;
}

/** Thay key, mọi chuỗi con ≥ 8 ký tự liền của key, và mẫu sk-/sk_/AIza… bằng "***". */
export function redactKey(text: string, key: string): string {
  let out = text;
  if (key.length > 0) {
    const minRun = Math.min(MIN_KEY_RUN, key.length);
    let acc = "";
    let i = 0;
    while (i < out.length) {
      const run = keyRunAt(out, i, key);
      if (run >= minRun) {
        acc += MASK;
        i += run;
      } else {
        acc += out[i];
        i++;
      }
    }
    out = acc;
  }
  return out.replace(KEY_LIKE, MASK);
}

function rawMessageOf(body: string): string {
  try {
    const j: unknown = JSON.parse(body);
    if (j && typeof j === "object") {
      const o = j as { error?: unknown; message?: unknown };
      const e = o.error as { message?: unknown } | undefined;
      if (e && typeof e === "object" && typeof e.message === "string") return e.message;
      if (typeof o.error === "string") return o.error;
      if (typeof o.message === "string") return o.message;
    }
  } catch {
    // không phải JSON ⇒ text thô
  }
  return body;
}

/** Thông điệp lỗi hãng: JSON {error:{message}} | {error} | {message} | text thô ⇒ che key ⇒ cắt 500; rỗng ⇒ null. */
export function errorMessageOf(body: string, key: string): string | null {
  const msg = redactKey(rawMessageOf(body).slice(0, SCAN_MAX), key).trim().slice(0, MESSAGE_MAX);
  return msg === "" ? null : msg;
}

const latency = (ms: number): number => Math.max(0, Math.round(ms));

/** 2xx ⇒ ok; 401/403 ⇒ auth_failed; mã khác ⇒ http_error; timeout/network ⇒ error, http_status null. */
export function checkOutcome(
  hit: CheckHit,
  key: string,
  latencyMs: number,
  now: Date,
): ProviderCheckResult {
  const base = { latency_ms: latency(latencyMs), checked_at: now.toISOString() };
  if (typeof hit === "string")
    return { status: "error", error_code: hit, http_status: null, message: null, ...base };
  if (hit.status >= 200 && hit.status < 300)
    return { status: "ok", error_code: null, http_status: hit.status, message: null, ...base };
  const auth = hit.status === 401 || hit.status === 403;
  return {
    status: "error",
    error_code: auth ? "auth_failed" : "http_error",
    http_status: hit.status,
    message: errorMessageOf(hit.body, key),
    ...base,
  };
}

/** Lỗi `fetch`: TimeoutError/AbortError ⇒ timeout; còn lại ⇒ network. */
export function hitOfFetchError(e: unknown): "timeout" | "network" {
  const name = e && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

type ProbeState = { status: string; lastProbeAt: Date | null; lastError: string | null };

/** Subscription: chưa có probe mới (≥ t0) ⇒ null; ok|busy ⇒ ok; khác ⇒ error, message = last_error đã che. */
export function subscriptionOutcome(
  state: ProbeState | undefined,
  t0: Date,
  now: Date,
): ProviderCheckResult | null {
  if (!state?.lastProbeAt || state.lastProbeAt.getTime() < t0.getTime()) return null;
  const base = {
    error_code: null,
    http_status: null,
    latency_ms: latency(now.getTime() - t0.getTime()),
    checked_at: now.toISOString(),
  };
  if (state.status === "ok" || state.status === "busy")
    return { status: "ok", message: null, ...base };
  const msg = redactKey((state.lastError ?? "").slice(0, SCAN_MAX), "")
    .trim()
    .slice(0, MESSAGE_MAX);
  return { status: "error", message: msg === "" ? null : msg, ...base };
}

// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · HUB-BR-37 · HUB-BR-40 · CR-073 · plan K1 §2.1: luật thuần KnowledgeHub
// (không I/O) — chính sách URL (https / loopback dev / allowlist), phiên bản ≥ v6.4, "dùng được", project từ `GET /projects`,
// embedder chỉ tiếng Anh, phân loại lỗi hạ cấp, thử lại ghi + lùi, snapshot audit kết nối (không giá trị khoá).
import { KH_MIN_VERSION, KH_PROJECT_ID_RE, type KhWarningCode } from "@ai/contracts/hub-admin";

export type KhUrlReject = "invalid" | "not_https" | "not_in_allowlist";
export type KhUrlResult =
  | { ok: true; baseUrl: string; localDev: boolean }
  | { ok: false; reason: KhUrlReject };
/** Kết quả một lời gọi HTTP tới KH: mã HTTP, hoặc hết giờ / lỗi mạng (DNS, TCP, TLS, redirect bị chặn). */
export type KhFailure = number | "timeout" | "network";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function originOf(raw: string): string | null {
  return parseUrl(raw.trim())?.origin ?? null;
}

/**
 * https; http chỉ khi `env.dev` ∧ host loopback (`localDev = true`); origin ∈ `allowed`; không userinfo/query/fragment;
 * bỏ "/" cuối. Gọi khi lưu **và** trước mỗi lời gọi KH (spec §3.4).
 */
export function khUrlPolicy(
  raw: string,
  allowed: readonly string[],
  env: { dev: boolean },
): KhUrlResult {
  const s = raw.trim();
  const u = s === "" || /[?#\s]/.test(s) ? null : parseUrl(s);
  if (u === null) return { ok: false, reason: "invalid" };
  const userinfo = u.username !== "" || u.password !== "";
  if (userinfo || (u.protocol !== "https:" && u.protocol !== "http:"))
    return { ok: false, reason: "invalid" };
  const localDev = u.protocol === "http:";
  if (localDev && !(env.dev && LOOPBACK.has(u.hostname))) return { ok: false, reason: "not_https" };
  const origins = new Set(allowed.map(originOf).filter((o): o is string => o !== null));
  if (!origins.has(u.origin)) return { ok: false, reason: "not_in_allowlist" };
  return { ok: true, baseUrl: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, localDev };
}

/** Origin cấu hình mà `khUrlPolicy` nhận được (bỏ rác, http không loopback / http ở production) — `GET C allowed_origins`. */
export function khUsableOrigins(allowed: readonly string[], env: { dev: boolean }): string[] {
  const out = new Set<string>();
  for (const o of allowed) {
    const r = khUrlPolicy(o, allowed, env);
    if (r.ok) out.add(new URL(r.baseUrl).origin);
  }
  return [...out];
}

const VERSION_RE = /^v?(\d{1,4})\.(\d{1,4})(?:[.\-+][0-9A-Za-z.\-+]*)?$/;

/** "v6.4" | "6.4.1" ⇒ [6, 4]; khác (không phải chuỗi, rác) ⇒ null. */
export function parseKhVersion(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = VERSION_RE.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/** ≥ `KH_MIN_VERSION` (v6.4). */
export function khVersionOk(v: [number, number] | null): boolean {
  if (!v) return false;
  const [maj, min] = KH_MIN_VERSION;
  return v[0] > maj || (v[0] === maj && v[1] >= min);
}

/** D3 · "dùng được" (phần trạng thái) = lần kiểm gần nhất đạt; URL kiểm riêng mỗi lời gọi. */
export function khConnectionUsable(c: { checkStatus: string }): boolean {
  return c.checkStatus === "ok";
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `body.projects` là object ⇒ khoá hợp lệ `KhProjectId`, sắp tăng, bỏ trùng; khác ⇒ null. */
export function parseKhProjects(body: unknown): string[] | null {
  if (!isPlainObject(body) || !isPlainObject(body.projects)) return null;
  const ids = Object.keys(body.projects).filter((k) => KH_PROJECT_ID_RE.test(k));
  return [...new Set(ids)].sort();
}

const ENGLISH_ONLY_RE = /(^|[-_/])en([-_.]|$)/i;

/** Q33 · tên model có đoạn `en` (`-en`, `_en`, `/en`, `en.`) ⇒ embedder chỉ tiếng Anh. */
export function embedderEnglishOnly(model: string | null): boolean {
  return model !== null && ENGLISH_ONLY_RE.test(model);
}

const STATUS_CODE: Readonly<Record<number, KhWarningCode>> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  400: "invalid",
  413: "invalid",
  422: "invalid",
  429: "rate_limited",
};

/** 401/403/404/400·413·422/429 theo bảng; 5xx/khác ⇒ `server_error`; timeout; network ⇒ `unreachable`. */
export function classifyKhFailure(f: KhFailure): KhWarningCode {
  if (f === "timeout") return "timeout";
  if (f === "network") return "unreachable";
  return STATUS_CODE[f] ?? "server_error";
}

/** timeout, network, 429, 5xx ⇒ thử lại; 4xx khác ⇒ `failed` ngay. */
export function khWriteRetryable(f: KhFailure): boolean {
  if (f === "timeout" || f === "network") return true;
  return f === 429 || f >= 500;
}

const WRITE_BACKOFF_BASE_MS = 30_000;

/** 30 000 × 2^(attempts − 1); attempts < 1 coi như 1. */
export function writeBackoffMs(attempts: number): number {
  return WRITE_BACKOFF_BASE_MS * 2 ** (Math.max(1, Math.floor(attempts)) - 1);
}

/** Snapshot audit kết nối — chỉ tham chiếu `secret_id`, không bao giờ giá trị khoá (HUB-BR-36). */
export function khConnectionAudit(c: {
  name: string;
  baseUrl: string;
  secretId: string;
  summaryProject: string | null;
  version: number;
}): Record<string, unknown> {
  return {
    name: c.name,
    base_url: c.baseUrl,
    secret_id: c.secretId,
    summary_project: c.summaryProject,
    version: c.version,
  };
}

/** Cursor list kết nối = `(lower(name), id)` (thứ tự ORDER BY, spec §3.2). */
export type KhConnCursor = [string, string];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeKhCursor(k: KhConnCursor): string {
  return Buffer.from(JSON.stringify(k), "utf8").toString("base64url");
}

/** Hỏng / sai hình ⇒ undefined (trang đầu, không ném) — như cursor secrets. */
export function decodeKhCursor(raw: string | undefined): KhConnCursor | undefined {
  if (raw === undefined || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === "string" &&
      UUID_RE.test(String(v[1]))
    )
      return [v[0], String(v[1])];
  } catch {
    // JSON hỏng ⇒ trang đầu
  }
  return undefined;
}

export type KhSecretRow = { kind: string; tenantId: string | null };
export type KhSecretReject = "not_found" | "wrong_kind" | "not_platform";

/** Q29 · khoá kết nối phải `kh_api_key` ∧ nền tảng (`tenant_id IS NULL`). Hợp lệ ⇒ null. */
export function khSecretReject(s: KhSecretRow | undefined): KhSecretReject | null {
  if (!s) return "not_found";
  if (s.kind !== "kh_api_key") return "wrong_kind";
  return s.tenantId === null ? null : "not_platform";
}

/** Q34/D3 · đổi `base_url` (đã chuẩn hoá) hoặc `secret_id` ⇒ kết quả kiểm cũ không còn giá trị. */
export function khResetsCheck(
  before: { baseUrl: string; secretId: string },
  after: { baseUrl: string; secretId: string },
): boolean {
  return (
    before.baseUrl !== after.baseUrl ||
    before.secretId.toLowerCase() !== after.secretId.toLowerCase()
  );
}

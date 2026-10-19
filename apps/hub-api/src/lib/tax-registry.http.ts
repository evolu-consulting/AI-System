// HD-FR-25 · Q10 · D2-06: tra MST Cục Thuế qua dịch vụ ngoài (mặc định dạng VietQR `GET <base>/<mst>` — mirror GDT, không
// khoá; `R/api/app/companies/registry.py`). Egress phải cấu hình rõ: `CONTRACTS_TAX_LOOKUP_URL` (vắng ⇒ không tra). Cache
// (có 24 h, không có 1 h), giãn ≥ 2 s giữa hai lời gọi (`registry.py:13`: dồn ⇒ bị cấm 77 s), 429 ⇒ nghỉ theo `Retry-After`.
// Khe chưa tới / đang nghỉ ⇒ trả `unavailable` NGAY kèm `retryAt` (người gọi hẹn tra lại, không ngủ chờ — Luật 4c). Transport (`fetch`) tiêm được ⇒ test không ra mạng. Không bao giờ ném; log không chứa MST.
// Nằm ở `lib/` (egress của Hub), không trong module gói: gói không gọi HTTP (PK-AC12); `packs.mount.ts` tiêm vào gói qua cổng
// `TaxRegistry` (kiểu cấu trúc trùng `modules/packs/contracts/application/extraction.ports.ts`).

export type TaxLookup =
  | {
      result: "found";
      name: string;
      status: string | null;
      shortName?: string | null;
      internationalName?: string | null;
    }
  | { result: "unavailable"; retryAt?: number }
  | { result: "not_found" | "invalid" };
export type TaxRegistry = { lookup(taxId: string, o: { fast: boolean }): Promise<TaxLookup> };

export type TaxFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
  status: number;
  headers: { get(k: string): string | null };
  text(): Promise<string>;
}>;

export type TaxRegistryDeps = {
  baseUrl: string;
  fetch?: TaxFetch;
  now?: () => number;
  /** Người dùng đang chờ (nhập tay) / nền (trích). */
  timeoutMs?: { fast: number; slow: number };
  /** Khoảng cách tối thiểu giữa hai lời gọi (mặc định 2.000 ms như `registry.py:13`). */
  intervalMs?: number;
  log?: { warn(msg: string, fields?: Record<string, unknown>): void };
};

const TTL_MS = { found: 86_400_000, not_found: 3_600_000 } as const;
const MAX_CACHE = 5_000;
const BODY_MAX = 64 * 1024;

type Body = {
  code?: unknown;
  data?: {
    name?: unknown;
    status?: unknown;
    shortName?: unknown;
    internationalName?: unknown;
  } | null;
};
const opt = (v: unknown): string | null => (typeof v === "string" && clean(v)) || null;

/** Dữ liệu ngoài vào câu cảnh báo/`jsonb`: bỏ ký tự điều khiển (NUL ⇒ 5xx ở Postgres), cắt ≤ 300 (review S-m2). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: chủ ý lọc ký tự điều khiển từ dịch vụ ngoài
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (v: string): string => v.replace(CONTROL, " ").trim().slice(0, 300);

function toLookup(body: Body): TaxLookup {
  if (body.code === "51") return { result: "not_found" };
  const d = body.code === "00" ? body.data : null;
  if (!d || typeof d.name !== "string" || d.name === "") return { result: "unavailable" };
  const name = clean(d.name);
  if (!name) return { result: "unavailable" };
  return {
    result: "found",
    name,
    status: opt(d.status),
    shortName: opt(d.shortName),
    internationalName: opt(d.internationalName),
  };
}

/** URL tuyệt đối http(s), không thông tin đăng nhập; sai ⇒ null (không tra). */
export function taxBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Một lời gọi HTTP: 429 ⇒ `{retryAfter}`; lỗi/thân lạ/quá trần ⇒ `unavailable`; không ném. */
async function callRegistry(
  doFetch: TaxFetch,
  url: string,
  o: { timeoutMs: number; log?: TaxRegistryDeps["log"] },
): Promise<TaxLookup | { retryAfter: string | null }> {
  try {
    const r = await doFetch(url, {
      signal: AbortSignal.timeout(o.timeoutMs),
      headers: { accept: "application/json" },
    });
    if (r.status === 429) return { retryAfter: r.headers.get("retry-after") };
    if (r.status < 200 || r.status >= 300) return { result: "unavailable" };
    const text = await r.text();
    if (text.length > BODY_MAX) return { result: "unavailable" }; // trần thân phản hồi (S-m4)
    return toLookup(JSON.parse(text) as Body);
  } catch (e) {
    o.log?.warn("tax-lookup-failed", { error: e instanceof Error ? e.name : "unknown" });
    return { result: "unavailable" };
  }
}

export function createTaxRegistry(d: TaxRegistryDeps): TaxRegistry {
  const doFetch: TaxFetch = d.fetch ?? ((url, init) => fetch(url, { ...init, redirect: "error" }));
  const now = d.now ?? Date.now;
  const tmo = d.timeoutMs ?? { fast: 4_000, slow: 20_000 };
  const cache = new Map<string, { until: number; v: TaxLookup }>();
  const inflight = new Map<string, Promise<TaxLookup>>();
  const interval = d.intervalMs ?? 2_000;
  let coolUntil = 0;
  let nextAt = 0;

  const remember = (taxId: string, out: TaxLookup): TaxLookup => {
    if (out.result !== "found" && out.result !== "not_found") return out;
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(taxId, { until: now() + TTL_MS[out.result], v: out });
    return out;
  };
  const coolDown = (retryAfter: string | null): TaxLookup => {
    const wait = Math.min(600, Math.max(1, Number(retryAfter) || 60)); // kẹp 1–600 s (S-m3)
    coolUntil = now() + wait * 1000;
    d.log?.warn("tax-lookup-rate-limited", { retry_after_s: wait });
    return { result: "unavailable", retryAt: coolUntil };
  };
  const ask = async (taxId: string, fast: boolean): Promise<TaxLookup> => {
    const out = await callRegistry(doFetch, `${d.baseUrl}/${encodeURIComponent(taxId)}`, {
      timeoutMs: fast ? tmo.fast : tmo.slow,
      log: d.log,
    });
    return "retryAfter" in out ? coolDown(out.retryAfter) : remember(taxId, out);
  };
  return {
    lookup: async (taxId, o) => {
      const hit = cache.get(taxId);
      if (hit && hit.until > now()) return hit.v;
      if (now() < coolUntil) return { result: "unavailable", retryAt: coolUntil };
      // Gộp chỉ khi cùng loại (`fast` không chờ lượt nền 20 s — review Thấp 6).
      const key = `${o.fast ? "f" : "s"}:${taxId}`;
      const going = inflight.get(key);
      if (going) return going;
      // Khe 2 s chưa tới ⇒ không gọi, hẹn giờ (Trung 4).
      if (now() < nextAt) return { result: "unavailable", retryAt: nextAt };
      nextAt = now() + interval;
      const p = ask(taxId, o.fast).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}

// HD-FR-25 · Q10 · D2-06: tra MST Cục Thuế qua dịch vụ ngoài (mặc định dạng VietQR `GET <base>/<mst>` — mirror GDT, không
// khoá; `R/api/app/companies/registry.py`). Egress phải cấu hình rõ: `CONTRACTS_TAX_LOOKUP_URL` (vắng ⇒ không tra). Cache
// (có 24 h, không có 1 h), gộp lời gọi trùng đang bay, 429 ⇒ nghỉ theo `Retry-After` và trả `unavailable` NGAY (không ngủ
// chờ lượt — Luật 4c). Transport (`fetch`) tiêm được ⇒ test không ra mạng. Không bao giờ ném; log không chứa MST.
// Nằm ở `lib/` (egress của Hub), không trong module gói: gói không gọi HTTP (PK-AC12); `packs.mount.ts` tiêm vào gói qua cổng
// `TaxRegistry` (kiểu cấu trúc trùng `modules/packs/contracts/application/extraction.ports.ts`).

export type TaxLookup =
  | { result: "found"; name: string; status: string | null }
  | { result: "not_found" | "unavailable" | "invalid" };
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
  log?: { warn(msg: string, fields?: Record<string, unknown>): void };
};

const TTL_MS = { found: 86_400_000, not_found: 3_600_000 } as const;
const MAX_CACHE = 5_000;
const BODY_MAX = 64 * 1024;

type Body = { code?: unknown; data?: { name?: unknown; status?: unknown } | null };

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
  return { result: "found", name, status: typeof d.status === "string" ? clean(d.status) : null };
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

export function createTaxRegistry(d: TaxRegistryDeps): TaxRegistry {
  const doFetch: TaxFetch = d.fetch ?? ((url, init) => fetch(url, { ...init, redirect: "error" }));
  const now = d.now ?? Date.now;
  const tmo = d.timeoutMs ?? { fast: 4_000, slow: 20_000 };
  const cache = new Map<string, { until: number; v: TaxLookup }>();
  const inflight = new Map<string, Promise<TaxLookup>>();
  let coolUntil = 0;

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
    return { result: "unavailable" };
  };
  const ask = async (taxId: string, fast: boolean): Promise<TaxLookup> => {
    try {
      const r = await doFetch(`${d.baseUrl}/${encodeURIComponent(taxId)}`, {
        signal: AbortSignal.timeout(fast ? tmo.fast : tmo.slow),
        headers: { accept: "application/json" },
      });
      if (r.status === 429) return coolDown(r.headers.get("retry-after"));
      if (r.status < 200 || r.status >= 300) return { result: "unavailable" };
      const text = await r.text();
      if (text.length > BODY_MAX) return { result: "unavailable" }; // trần thân phản hồi (S-m4)
      return remember(taxId, toLookup(JSON.parse(text) as Body));
    } catch (e) {
      d.log?.warn("tax-lookup-failed", { error: e instanceof Error ? e.name : "unknown" });
      return { result: "unavailable" };
    }
  };

  return {
    lookup: async (taxId, o) => {
      const hit = cache.get(taxId);
      if (hit && hit.until > now()) return hit.v;
      if (now() < coolUntil) return { result: "unavailable" };
      const going = inflight.get(taxId);
      if (going) return going;
      const p = ask(taxId, o.fast).finally(() => inflight.delete(taxId));
      inflight.set(taxId, p);
      return p;
    },
  };
}

// ADM-FR-40 · M4-R02 · bản nháp quota của tab Quota: chuỗi ô nhập ↔ payload PUT; validate khớp contract (QuotaItemInputSchema).
// Hàm thuần; thông điệp là KEY i18n.
import {
  type LocalizedText,
  QUOTA_MAX_RUNS,
  QUOTA_MAX_TOKENS,
  type QuotaItemInput,
  type QuotaSetResponse,
} from "@ai/contracts";
import { pickLocalized } from "@/lib/localized";

export type QuotaField = "runs" | "tokens" | "usd";
export type QuotaRow = {
  feature_id: string | null;
  key: string | null;
  name: string;
  runs: string;
  tokens: string;
  usd: string;
};
/** Feature thêm được quota (core + đã entitlement). */
export type QuotaFeatureOption = { id: string; key: string; name: LocalizedText };
export const QUOTA_FIELDS: readonly QuotaField[] = ["runs", "tokens", "usd"];

const str = (n: number | string | null) => (n === null ? "" : String(n));

export function rowsFromResponse(res: QuotaSetResponse, lang: string): QuotaRow[] {
  return res.items.map((i) => ({
    feature_id: i.feature_id,
    key: i.feature_key,
    name: i.feature_name ? pickLocalized(i.feature_name, lang) : (i.feature_key ?? ""),
    runs: str(i.max_runs),
    tokens: str(i.max_tokens),
    usd: i.max_usd === null ? "" : String(Number(i.max_usd)),
  }));
}

/** Hàng "Cả tenant" luôn có, đứng đầu. */
export function ensureTenantRow(rows: QuotaRow[], emptyName: string): QuotaRow[] {
  if (rows.some((r) => r.feature_id === null)) return rows;
  return [{ feature_id: null, key: null, name: emptyName, runs: "", tokens: "", usd: "" }, ...rows];
}

/** Trống hợp lệ (= không giới hạn). Trả key i18n khi sai. */
export function validateCell(field: QuotaField, raw: string): string | undefined {
  const v = raw.trim();
  if (v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "quota.error.positive";
  if (field === "usd") {
    return /^\d{1,10}(\.\d{1,2})?$/.test(v) ? undefined : "quota.error.usdFormat";
  }
  if (!Number.isInteger(n)) return "quota.error.integer";
  return n > (field === "runs" ? QUOTA_MAX_RUNS : QUOTA_MAX_TOKENS)
    ? "quota.error.positive"
    : undefined;
}

export function rowHasError(r: QuotaRow): boolean {
  return QUOTA_FIELDS.some((f) => validateCell(f, r[f]) !== undefined);
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Dòng mọi giới hạn trống bị bỏ (server cũng bỏ). */
export function toItems(rows: QuotaRow[]): QuotaItemInput[] {
  return rows
    .map((r) => ({
      feature_id: r.feature_id,
      max_runs: num(r.runs),
      max_tokens: num(r.tokens),
      max_usd: r.usd.trim() === "" ? null : String(Number(r.usd)),
    }))
    .filter((i) => i.max_runs !== null || i.max_tokens !== null || i.max_usd !== null);
}

/** Chữ ký nội dung (không tính tên/key hiển thị) để so bẩn/sạch. */
export function signature(rows: QuotaRow[]): string {
  return JSON.stringify(toItems(rows));
}

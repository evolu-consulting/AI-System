// HD-FR-23 · HD-FR-25 · review HD2 Trung 4: tra MST hai bên (song song, ngoài tx) + tra lại theo hẹn giờ. Cổng giãn ≥ 2 s và
// nghỉ khi 429 trả `unavailable` kèm `retryAt` ⇒ người gọi hẹn một lượt `refreshParties` đúng giờ đó (không ngủ chờ, không
// vòng poll). `refreshParties`: đọc HĐ (1 câu) → tra lại → chỉ thay `warnings` khi `version` chưa đổi (không đè sửa mới hơn).
import type { PackWho } from "../../kit/application/ports";
import type { ContractFields } from "../domain/fields.rules";
import { fillFields } from "../domain/fields.rules";
import { partyCheck, type TaxLookup } from "../domain/party.rules";
import { normalizeTaxId, type Parties, ruleWarnings } from "../domain/warnings.rules";
import type { ExtractionUow, TaxRegistry } from "./extraction.ports";

export type TaxHits = ReadonlyMap<string, TaxLookup>;
/** Hẹn tra lại MST lúc `at` (epoch ms) — hàng đợi trích cài (một bộ hẹn giờ mỗi HĐ). */
export type TaxRetryScheduler = (
  who: PackWho,
  contractId: string,
  at: number,
  attempt: number,
) => void;
export const TAX_RETRY_MAX = 5;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Tra các MST (đã chuẩn hoá, bỏ trùng) song song; không có cổng ⇒ map rỗng (chỉ kiểm định dạng). */
export async function prefetchTax(
  tax: TaxRegistry | null,
  raws: readonly (string | null)[],
  fast: boolean,
): Promise<TaxHits> {
  const ids = [...new Set(raws.map((r) => normalizeTaxId(r)).filter((x): x is string => !!x))];
  if (!tax || ids.length === 0) return new Map();
  const res = await Promise.all(ids.map((id) => tax.lookup(id, { fast })));
  return new Map(ids.map((id, i) => [id, res[i] as TaxLookup]));
}

/** Kết quả Cục Thuế của hai bên theo trường hiện tại (thuần trên map đã tra). */
export function partiesOf(f: ContractFields, hits: TaxHits): Parties {
  const side = (name: unknown, raw: unknown) => {
    const tax = str(raw);
    const id = normalizeTaxId(tax);
    return partyCheck(str(name), tax, id ? (hits.get(id) ?? null) : null);
  };
  return {
    supplier: side(f.supplier_name.value, f.supplier_tax_id.value),
    buyer: side(f.buyer_name.value, f.buyer_tax_id.value),
  };
}

/** Giờ tra lại sớm nhất (MST của HĐ chưa tra được nhưng cổng hẹn giờ); không cần ⇒ null. */
export function retryAtOf(f: ContractFields, hits: TaxHits): number | null {
  let at: number | null = null;
  for (const k of ["supplier_tax_id", "buyer_tax_id"] as const) {
    const id = normalizeTaxId(str(f[k].value));
    const h = id ? hits.get(id) : undefined;
    if (h?.result === "unavailable" && h.retryAt !== undefined)
      at = at === null ? h.retryAt : Math.min(at, h.retryAt);
  }
  return at;
}

/** Lượt tra lại MST của HĐ đã `needs_review`; còn hẹn ⇒ hẹn tiếp (≤ `TAX_RETRY_MAX` lần). */
export function createRefreshParties(d: {
  uow: ExtractionUow;
  tax: TaxRegistry | null;
  schedule?: TaxRetryScheduler;
}) {
  return async (who: PackWho, id: string, attempt: number): Promise<"updated" | "skipped"> => {
    const src = await d.uow.tenant(who, (r) => r.extraction.source(id));
    if (!src || src.status !== "needs_review") return "skipped";
    const f = fillFields(src.fields);
    const hits = await prefetchTax(
      d.tax,
      [str(f.supplier_tax_id.value), str(f.buyer_tax_id.value)],
      false,
    );
    const warnings = ruleWarnings(f, src.items, null, partiesOf(f, hits));
    const ok = await d.uow.tenant(who, (r) => r.extraction.saveWarnings(id, warnings, src.version));
    const at = retryAtOf(f, hits);
    if (ok && at !== null && attempt < TAX_RETRY_MAX) d.schedule?.(who, id, at, attempt + 1);
    return ok ? "updated" : "skipped";
  };
}
export type RefreshParties = ReturnType<typeof createRefreshParties>;

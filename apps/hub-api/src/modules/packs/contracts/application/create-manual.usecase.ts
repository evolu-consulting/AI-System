// HD-FR-26 · Q15 · D2-04: nhập tay HĐ không file. Tra MST đối tác nhanh (ngoài tx, lỗi/chậm ⇒ chỉ kiểm định dạng) →
// trường `edited` + dòng hàng + cảnh báo → MỘT tx: CTE (HĐ `needs_review` + dòng hàng lô JSON + event) + outbox.
import type { PackWho } from "../../kit/application/ports";
import { type ManualInput, manualFields, manualItems } from "../domain/manual.rules";
import { ruleWarnings } from "../domain/warnings.rules";
import type { ExtractionUow, TaxRegistry } from "./extraction.ports";
import { partiesOf, prefetchTax, retryAtOf, type TaxRetryScheduler } from "./tax-parties";

export type CreateManual = (
  who: PackWho,
  input: ManualInput,
) => Promise<{ id: string; status: "needs_review"; version: number }>;

export function createManual(d: {
  uow: ExtractionUow;
  tax: TaxRegistry | null;
  newId: () => string;
  /** MST đối tác chưa tra được vì cổng hẹn giờ ⇒ hẹn tra lại (review Trung 4). */
  schedule?: TaxRetryScheduler;
}): CreateManual {
  return async (who, input) => {
    const fields = manualFields(input);
    const items = manualItems(input.items);
    const hits = await prefetchTax(d.tax, [input.partner_tax_id ?? null], true);
    const warnings = ruleWarnings(fields, items, null, partiesOf(fields, hits));
    const out = await d.uow.tenant(who, async (r) => {
      const row = await r.extraction.insertManual({
        id: d.newId(),
        title: input.title.trim(),
        direction: input.direction,
        fields,
        items,
        warnings,
        userId: who.userId,
      });
      await r.outbox.enqueue([{ entity: "contract", entity_id: row.id, op: "upsert" }]);
      return row;
    });
    const at = retryAtOf(fields, hits);
    if (at !== null) d.schedule?.(who, out.id, at, 1);
    return { id: out.id, status: "needs_review", version: out.version };
  };
}

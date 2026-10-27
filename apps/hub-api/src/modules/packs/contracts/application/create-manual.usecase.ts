// HD-FR-26 · Q15 · D2-04: nhập tay HĐ không file. Tra MST đối tác nhanh (ngoài tx, lỗi/chậm ⇒ chỉ kiểm định dạng) →
// trường `edited` + dòng hàng + cảnh báo → MỘT tx: CTE (HĐ + dòng hàng lô JSON + event [+ mốc mặc định]) + outbox.
// V2-A · HD-01 · C3: loại HĐ (Mua/Bán/Giới thiệu) + hoa hồng; tenant TẮT duyệt ⇒ cùng câu ghi HĐ `active` (lưu = có hiệu lực) và
// mốc mặc định theo loại (ngày lịch tenant); tenant bật duyệt ⇒ `needs_review` như cũ (mốc HD7 sinh khi duyệt).
import type { PackWho } from "../../kit/application/ports";
import { asDate } from "../domain/fold.rules";
import {
  dealAndDirection,
  type ManualInput,
  manualFields,
  manualItems,
} from "../domain/manual.rules";
import { defaultMilestones, toDb } from "../domain/milestones.rules";
import { ruleWarnings } from "../domain/warnings.rules";
import type { ExtractionUow, TaxRegistry } from "./extraction.ports";
import type { MilestoneWrite } from "./milestones.ports";
import { partiesOf, prefetchTax, retryAtOf, type TaxRetryScheduler } from "./tax-parties";

export type CreateManual = (
  who: PackWho,
  input: ManualInput,
  /** CR-101 DOC-deals: có ⇒ tạo GIAO DỊCH (`doc_type = 'deal'` + nguồn), luôn `active` + mốc mặc định, không khoá. */
  deal?: { source: "invoice" | "verbal" | "message" | "quote" | "other" },
) => Promise<{ id: string; status: "needs_review" | "active"; version: number }>;

/** Mốc mặc định của HĐ nhập tay ⇒ hàng ghi (tiền để trống: 5.4a tính từ giá trị khi đọc). */
export function manualMilestones(input: ManualInput, today: string): MilestoneWrite[] {
  const { deal } = dealAndDirection(input);
  return defaultMilestones({
    deal,
    start: asDate(input.start_date ?? null),
    end: asDate(input.end_date ?? null),
    signed: null,
    today,
  }).map((m) => ({
    ...toDb(m.kind, deal),
    title: m.title,
    owner: m.owner,
    due_date: m.due_date,
    qty: null,
    amount: null,
  }));
}

export function createManual(d: {
  uow: ExtractionUow;
  tax: TaxRegistry | null;
  newId: () => string;
  /** Ngày lịch của tenant (`YYYY-MM-DD`) — hạn mốc mặc định khi HĐ chưa có ngày. */
  today: (tenantId: string) => Promise<string>;
  /** MST đối tác chưa tra được vì cổng hẹn giờ ⇒ hẹn tra lại (review Trung 4). */
  schedule?: TaxRetryScheduler;
}): CreateManual {
  return async (who, input, dealDoc) => {
    const fields = manualFields(input);
    const items = manualItems(input.items);
    const { deal, direction } = dealAndDirection(input);
    const milestones = manualMilestones(input, await d.today(who.tenantId));
    const hits = await prefetchTax(d.tax, [input.partner_tax_id ?? null], true);
    const warnings = ruleWarnings(fields, items, null, partiesOf(fields, hits));
    const out = await d.uow.tenant(who, async (r) => {
      const row = await r.extraction.insertManual({
        id: d.newId(),
        title: input.title.trim(),
        direction,
        deal,
        commissionPct: deal === "referral" ? (input.commission_pct ?? null) : null,
        commissionFixed: deal === "referral" ? (input.commission_fixed ?? null) : null,
        milestones,
        fields,
        items,
        warnings,
        userId: who.userId,
        ...(dealDoc ? { deal_doc: dealDoc } : {}),
      });
      await r.outbox.enqueue([{ entity: "contract", entity_id: row.id, op: "upsert" }]);
      return row;
    });
    const at = retryAtOf(fields, hits);
    if (at !== null) d.schedule?.(who, out.id, at, 1);
    return { id: out.id, status: out.status, version: out.version };
  };
}

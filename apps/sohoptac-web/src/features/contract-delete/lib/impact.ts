// V2-M · các dòng tác động hiển thị trong hộp xác nhận xoá HĐ (thuần): chỉ liệt kê mục có số > 0, đúng thứ tự BA.
import type { DeleteImpact } from "@ai/contracts";

export type ImpactLine = { key: string; vars: Record<string, string | number> };

export function impactLines(i: DeleteImpact): ImpactLine[] {
  const out: ImpactLine[] = [];
  if (i.milestones > 0) out.push({ key: "milestones", vars: { count: i.milestones } });
  if (i.delivered_lines > 0)
    out.push({ key: "deliveredLines", vars: { count: i.delivered_lines } });
  for (const s of i.stock)
    out.push({
      key: "stock",
      vars: {
        product: s.product,
        component: s.component,
        dirKey: s.direction === "in" ? "stockIn" : "stockOut",
        qty: s.qty,
      },
    });
  if (i.service_customers > 0) out.push({ key: "customers", vars: { count: i.service_customers } });
  if (i.partner_events > 0) out.push({ key: "events", vars: { count: i.partner_events } });
  if (i.appendices > 0) out.push({ key: "appendices", vars: { count: i.appendices } });
  if (i.has_cks) out.push({ key: "cks", vars: {} });
  return out;
}

/** Lý do không xoá được (kho không đảo được; máy chủ cũng chặn, 409) — null = xoá được. */
export const blockedReason = (i: DeleteImpact): string | null => i.stock_blocked;

/** products-confirm: SP người xoá đã tick để xoá theo — chỉ id thuộc danh sách SP mồ côi (máy chủ cũng kiểm lại). */
export const pickedProducts = (i: DeleteImpact, picked: ReadonlySet<string>): string[] =>
  i.orphan_products.filter((p) => picked.has(p.id)).map((p) => p.id);

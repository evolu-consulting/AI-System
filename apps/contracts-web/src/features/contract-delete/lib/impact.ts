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
  if (i.products.length > 0) out.push({ key: "products", vars: { names: i.products.join(", ") } });
  if (i.partner_events > 0) out.push({ key: "events", vars: { count: i.partner_events } });
  return out;
}

/** Chặn xoá: còn phụ lục hoặc gắn CKS (máy chủ cũng chặn, 409). */
export const blockedKey = (i: DeleteImpact): "appendix" | "cks" | null =>
  i.appendices > 0 ? "appendix" : i.has_cks ? "cks" : null;

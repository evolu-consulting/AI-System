// ADM-FR-42 · M4-R07/R08 · Quyết định hiển thị "Chưa định giá" cho một dòng Top list theo `unpriced_rows` + `billable_usd`.
export type PriceDisplay = "amount" | "partial" | "unpriced";

/**
 * `unpricedRows` = số HÀNG usage có billable_usd NULL (không so với `runs`: `runs` = count(distinct run_id)
 * bỏ hàng run_id NULL, khác đơn vị). `billableUsd` = tổng đã định giá của nhóm: 0 → không có gì để hiện.
 */
export function priceDisplay(unpricedRows: number, billableUsd: string): PriceDisplay {
  if (unpricedRows <= 0) return "amount";
  return Number(billableUsd) === 0 ? "unpriced" : "partial";
}

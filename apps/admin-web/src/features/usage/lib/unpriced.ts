// ADM-FR-42 · M4-R07/R08 · Quyết định hiển thị "Chưa định giá" cho một dòng Top list theo `unpriced_rows`.
export type PriceDisplay = "amount" | "partial" | "unpriced";

/** `unpriced_rows` = số hàng usage có billable_usd NULL; `runs` = tổng hàng của nhóm. */
export function priceDisplay(unpricedRows: number, runs: number): PriceDisplay {
  if (unpricedRows <= 0) return "amount";
  return unpricedRows >= runs ? "unpriced" : "partial";
}

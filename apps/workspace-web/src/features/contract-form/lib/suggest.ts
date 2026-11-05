// V2-F · BA 5.5b: kết quả gợi ý SP của một dòng HĐ (`POST /products/match`) → phần sửa dòng: gợi ý đầu tiên (kèm thành phần), hoặc đề xuất
// tạo SP mới từ tên dòng; không gợi ý gì ⇒ null (người dùng tự chọn). Thuần.
import type { ContractDeal, ProductMatchOut } from "@ai/contracts";
import { type LineState, NEW_PRODUCT } from "./form-model";

export function suggestionPatch(r: ProductMatchOut, deal: ContractDeal): Partial<LineState> | null {
  const top = r.suggestions[0];
  if (top) {
    const multi = top.product.components.length > 1;
    return {
      product_id: top.product.id,
      component_id: top.component_id ?? (multi ? (top.product.components[0]?.id ?? "") : ""),
      suggested: true,
    };
  }
  if (r.create)
    return {
      product_id: NEW_PRODUCT,
      new_name: r.create.name,
      new_group: deal === "referral" ? "referral" : "goods",
      suggested: true,
    };
  return null;
}

// V2-F · HD-01 · 5.5a: gợi ý SP danh mục cho dòng hàng qua `POST /products/match` (V2-B). Lỗi mạng ⇒ null (gợi ý là phụ).
import type { ContractDeal } from "@ai/contracts";
import { matchProduct } from "../api";
import type { LineState } from "../lib/form-model";
import { suggestionPatch } from "../lib/suggest";

export function useProductSuggest(deal: ContractDeal) {
  return async (text: string): Promise<Partial<LineState> | null> => {
    try {
      return suggestionPatch(await matchProduct(text, deal), deal) ?? null;
    } catch {
      return null;
    }
  };
}

// fix-extract-save · Lớp 1 (không I/O): MỘT luật cho cặp (loại HĐ `deal`, hướng `direction`, loại chứng từ `doc_type`) AI điền khi trích —
// phản chiếu CHECK `contracts_deal_ck`. Tổ hợp AI đoán không hợp lệ ⇒ bỏ `deal` (người chọn lại ở màn kiểm), KHÔNG làm hỏng lượt trích.
import type { AiRead } from "./extraction.types";
import { directionOfKind, isKindDeal, type Terms } from "./kind-terms.rules";
import { directionOfDeal } from "./milestones.rules";

export type DealRow = { deal: string | null; direction: string | null; docType: string };
export type DealWrite = { deal: string | null; direction: string | null };

/** Đúng điều kiện của `contracts_deal_ck` (migration): có `deal` thì phải có `direction` và khớp loại / loại chứng từ. */
export function dealCheckOk(
  deal: string | null,
  direction: string | null,
  docType: string,
): boolean {
  if (deal === null) return true;
  if (direction === null) return false;
  if (deal === "buy" || deal === "sell" || deal === "referral")
    return (deal === "buy") === (direction === "purchase");
  if (deal === "franchise")
    return (direction === "sale" || direction === "purchase") && docType === "contract";
  if (deal === "cooperation") return direction === "sale" && docType === "contract";
  return false;
}

/** Giá trị `deal`/`direction` ghi sau khi AI đọc (SQL ghi bằng `coalesce` ⇒ chỉ lấp ô còn trống, giữ lựa chọn của người dùng).
 *  Hướng thiếu ⇒ suy từ loại (Mua ⇒ purchase; Nhượng quyền theo vai; còn lại sale). Không hợp lệ ⇒ `deal: null`, hướng giữ nguyên. */
export function aiDealWrite(cur: DealRow, ai: AiRead | null): DealWrite {
  const keep = { deal: cur.deal, direction: cur.direction };
  const deal = ai?.deal;
  if (cur.deal !== null || !deal) return keep;
  // `aiReadOf` ghi thêm `kind_terms` đã chuẩn hoá vào bản đọc (kiểu `AiRead` khớp `@ai/contracts` nên không khai báo khoá này).
  const terms = (ai as { kind_terms?: Terms }).kind_terms ?? {};
  const direction =
    cur.direction ?? (isKindDeal(deal) ? directionOfKind(deal, terms) : directionOfDeal(deal));
  return dealCheckOk(deal, direction, cur.docType) ? { deal, direction } : keep;
}

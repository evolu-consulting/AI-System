// DOC-ui-list · R5–R10, Câu 3, 4: luật thuần của form Giao dịch — nguồn, ô "đã giao / đã thanh toán ngay", thân `POST /contracts/deals`,
// câu báo khi "xác nhận ngay" dừng giữa chừng (`settle_error`). Không React, không fetch.
import type { DealCreateRequest, DealSource } from "@ai/contracts";
import { DEAL_SOURCES } from "@ai/contracts";
import { type FormState, type Numbers, toRequest } from "./form-model";

export type { DealSource };
export { DEAL_SOURCES };

export type DealExtra = {
  /** "" = chưa chọn (bắt buộc chọn). */
  source: DealSource | "";
  settledNow: boolean;
  /** HĐ nguyên tắc chủ (id bản bất kỳ); null = đứng riêng. */
  frame: { id: string; title: string } | null;
};
export const EMPTY_EXTRA: DealExtra = { source: "", settledNow: false, frame: null };

/** Thân gửi API: các trường như form HĐ nhập tay, bỏ những trường chỉ của HĐ (kết thúc, nhắc hạn, người ký) + `source`/`settled_now`. */
export function toDealRequest(
  f: FormState,
  n: Numbers,
  productIds: readonly (string | null)[],
  x: DealExtra & { source: DealSource },
): DealCreateRequest {
  return {
    ...toRequest(f, n, productIds),
    deal: f.deal,
    end_date: null,
    notice_days: null,
    partner_signer: null,
    our_signer: null,
    source: x.source,
    ...(x.settledNow ? { settled_now: true } : {}),
  };
}

/** Mã lỗi "xác nhận ngay" có câu riêng (`contracts.doclist.settle.<mã>`); mã khác ⇒ câu chung kèm mã. */
export const KNOWN_SETTLE_ERRORS = [
  "STOCK_INSUFFICIENT",
  "DELIVERY_OVER",
  "DELIVERY_INVALID",
  "DELIVERY_LOCKED",
] as const;
export function settleErrorKey(code: string): string {
  return (KNOWN_SETTLE_ERRORS as readonly string[]).includes(code)
    ? `contracts.doclist.settle.${code}`
    : "contracts.doclist.settle.other";
}

// CR-120 · sau "Xác nhận và lưu" thẻ duyệt cho biết HĐ đã chuyển tới bước nào (không có bước "Gửi duyệt" thủ công: xác nhận bước 0 ⇒
// engine tự mở bước kế theo luật định tuyến). Thuần.
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { openStepOf } from "./engine-card";

/** Tên bước đang mở SAU bước soạn (idx ≥ 1) — ví dụ "Phòng Kế toán duyệt"; chưa mở / còn ở bước soạn ⇒ null. */
export function movedToStep(a: ContractApproval | undefined): string | null {
  const open = openStepOf(a);
  return open && open.idx >= 1 ? open.name : null;
}

/** Nút bấm lúc này là "Xác nhận và lưu" của bước soạn (bước mở có idx 0)? */
export const isDraftConfirm = (a: ContractApproval | undefined): boolean =>
  openStepOf(a)?.idx === 0;

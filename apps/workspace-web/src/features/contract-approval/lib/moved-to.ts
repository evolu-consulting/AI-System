// CR-120 · sau "Xác nhận và lưu" thẻ duyệt cho biết HĐ đã chuyển tới bước nào (không có bước "Gửi duyệt" thủ công: xác nhận bước 0 ⇒
// engine tự mở bước kế theo luật định tuyến). Thuần.
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { openStepOf } from "./engine-card";

/** Tên bước đang mở SAU bước soạn (idx ≥ 1) — ví dụ "Phòng Kế toán duyệt"; chưa mở / còn ở bước soạn ⇒ null. */
export function movedToStep(a: ContractApproval | undefined): string | null {
  const open = openStepOf(a);
  // Lượt flow theo sự kiện (`from_run`): bước 0 là stage thật (vd Duyệt) — không có bước soạn ⇒ mọi bước mở đều là "đã chuyển tới".
  return open && (open.idx >= 1 || a?.from_run === true) ? open.name : null;
}

/**
 * CR-125 · UX H5 · hạn (giờ nguyên, làm tròn lên, ≥ 1) của bước vừa mở — để nói "Đã gửi <bước> · hạn N giờ" ngay sau khi gửi duyệt;
 * bước chưa đặt hạn / hạn đã qua ⇒ null (không nói).
 */
export function movedToDueHours(a: ContractApproval | undefined, now: number): number | null {
  const open = movedToStep(a) === null ? null : openStepOf(a);
  if (!open?.due_at) return null;
  const ms = Date.parse(open.due_at) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 3_600_000)) : null;
}

/** Nút bấm lúc này là "Xác nhận và lưu" của bước soạn (bước mở có idx 0)? */
export const isDraftConfirm = (a: ContractApproval | undefined): boolean =>
  a?.from_run !== true && openStepOf(a)?.idx === 0;

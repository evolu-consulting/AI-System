// CR-122 · E3 · trạng thái cuối của phong bì ký ⇒ sự kiện gói bắn cho lượt flow đang chờ (node Ký số = gửi ký + Chờ sự kiện nhiều
// kết quả). Khoá khớp `AppEventDecl`/`wait_event.event|also_events`. Thuần, lớp 1. Nhà cung cấp nào cũng đi qua `ESignStatus` chung.
import type { ESignStatus } from "./esign.rules";

export const ESIGN_EVENTS = {
  completed: "esign.completed",
  declined: "esign.declined",
  voided: "esign.voided",
} as const;
export type ESignEvent = (typeof ESIGN_EVENTS)[keyof typeof ESIGN_EVENTS];

/** Trạng thái cuối ⇒ khoá sự kiện; trạng thái chưa cuối ⇒ null (không bắn). */
export function esignEventOf(st: ESignStatus): ESignEvent | null {
  if (st === "completed" || st === "declined" || st === "voided") return ESIGN_EVENTS[st];
  return null;
}

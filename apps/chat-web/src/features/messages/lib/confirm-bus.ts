// CR-169 · hộp xác nhận kiểu lệnh cho gói Tin nhắn (chat-web chưa có bus chung): `confirmDialog()` trả Promise<boolean>,
// `ConfirmHost` (gắn trong trang Tin nhắn) hiển thị. Không có host ⇒ trả false (không làm việc nguy hiểm khi không hỏi được).
import type { ReactNode } from "react";

export type ConfirmReq = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type Pending = ConfirmReq & { resolve: (ok: boolean) => void };

let show: ((r: Pending) => void) | null = null;

export function setConfirmHost(fn: ((r: Pending) => void) | null): void {
  show = fn;
}

export function confirmDialog(o: ConfirmReq): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ ...o, resolve });
  });
}
export type { Pending as PendingConfirm };

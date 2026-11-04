// PK-FR-10 · TF2 · confirmDialog / promptDialog gọi kiểu lệnh (như window.confirm), <DialogHost/> hiển thị.
// Nguồn: reference/mgmt-app-contracts/web/src/components/dialog.tsx:7-26 (bỏ CustomEvent → một bus module, kiểm thử được không cần DOM).
import type { ReactNode } from "react";

export type ConfirmReq = {
  kind: "confirm";
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
export type PromptReq = {
  kind: "prompt";
  title: string;
  body?: ReactNode;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  maxLength?: number;
};
export type Req = (ConfirmReq | PromptReq) & { resolve: (v: boolean | string | null) => void };

let host: ((r: Req) => void) | null = null;

/** DialogHost đăng ký khi mount; trả hàm gỡ. */
export function registerHost(fn: (r: Req) => void): () => void {
  host = fn;
  return () => {
    if (host === fn) host = null;
  };
}

/** Có/không: true khi đồng ý; false khi huỷ, Escape, bấm nền — hoặc khi chưa có DialogHost (không treo lời gọi). */
export function confirmDialog(o: Omit<ConfirmReq, "kind">): Promise<boolean> {
  return new Promise((resolve) => {
    if (!host) return resolve(false);
    host({ ...o, kind: "confirm", resolve: (v) => resolve(v === true) });
  });
}

/** Một dòng chữ: trả chuỗi đã trim, hoặc null nếu huỷ. `required` ⇒ nút lưu tắt tới khi có chữ. */
export function promptDialog(o: Omit<PromptReq, "kind">): Promise<string | null> {
  return new Promise((resolve) => {
    if (!host) return resolve(null);
    host({ ...o, kind: "prompt", resolve: (v) => resolve(typeof v === "string" ? v : null) });
  });
}

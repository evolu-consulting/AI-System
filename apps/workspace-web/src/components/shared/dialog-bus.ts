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
// CR-118 bundle: DialogHost tải lười ⇒ yêu cầu tới trước khi host mount được xếp hàng (không trả false sớm); host không tải được ⇒ trả mặc định.
let loading = false;
const queued: Req[] = [];

/** Root báo "DialogHost đang tải": confirm/prompt gọi sớm chờ host thay vì trả false/null. */
export function expectHost(chunk: Promise<unknown>): void {
  loading = true;
  // Chunk về ⇒ host đăng ký khi mount (registerHost xả hàng); tải lỗi ⇒ xả hàng với giá trị mặc định.
  void chunk.catch(() => {
    loading = false;
    for (const r of queued.splice(0)) r.resolve(r.kind === "confirm" ? false : null);
  });
}

function dispatch(r: Req): void {
  if (host) host(r);
  else if (loading) queued.push(r);
  else r.resolve(r.kind === "confirm" ? false : null);
}

/** DialogHost đăng ký khi mount; trả hàm gỡ. */
export function registerHost(fn: (r: Req) => void): () => void {
  host = fn;
  for (const r of queued.splice(0)) fn(r);
  return () => {
    if (host === fn) host = null;
  };
}

/** Có/không: true khi đồng ý; false khi huỷ, Escape, bấm nền — hoặc khi chưa có DialogHost (không treo lời gọi). */
export function confirmDialog(o: Omit<ConfirmReq, "kind">): Promise<boolean> {
  return new Promise((resolve) => {
    dispatch({ ...o, kind: "confirm", resolve: (v) => resolve(v === true) });
  });
}

/** Một dòng chữ: trả chuỗi đã trim, hoặc null nếu huỷ. `required` ⇒ nút lưu tắt tới khi có chữ. */
export function promptDialog(o: Omit<PromptReq, "kind">): Promise<string | null> {
  return new Promise((resolve) => {
    dispatch({ ...o, kind: "prompt", resolve: (v) => resolve(typeof v === "string" ? v : null) });
  });
}

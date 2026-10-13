// HUB-FR-128 · P-c1 · chip trạng thái của khối tự sửa mã (mockup Pc-Diff/Pc-Decision: b-ok / b-err / b-info / b-off / b-warn).
// chat-web chưa có `ui/badge`; bản nhỏ này chỉ dùng token theme (cùng cặp màu với admin-web `ui/badge`).
import type { ReactNode } from "react";

const TONE = {
  ok: "bg-success-bg text-success",
  err: "bg-danger-bg text-danger",
  warn: "bg-warning-bg text-warning",
  info: "bg-accent text-accent-foreground",
  off: "bg-muted text-muted-strong-foreground",
} as const;

export function Badge({ variant, children }: { variant: keyof typeof TONE; children: ReactNode }) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-caption font-medium whitespace-nowrap ${TONE[variant]}`}
    >
      {children}
    </span>
  );
}

// PK-FR-10 · TF2 · toast() bọc sonner, giữ API của mgmt-app (reference/mgmt-app-contracts/web/src/components/toast.tsx:11): toast("Đã lưu") / toast("Lỗi", "late").
// <Toaster/> gắn một lần ở route gốc (`components/ui/sonner.tsx`).
import { toast as sonner } from "sonner";

export type ToastKind = "ok" | "late";

/** Thông báo ngắn tự tắt: "ok" = thành công, "late" = lỗi ngắn. Lỗi cần ở lại thì vẫn dùng `role="alert"` trong trang. */
export function toast(message: string, kind: ToastKind = "ok"): void {
  if (kind === "late") sonner.error(message);
  else sonner.success(message);
}

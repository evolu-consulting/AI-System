// ADM-FR-60 · toast theo ui-admin §6: thành công tự ẩn sau 4 giây, lỗi phải bấm đóng mới mất.
import { toast } from "sonner";

export const SUCCESS_TOAST_MS = 4000;

export function notifySuccess(message: string): void {
  toast.success(message, { duration: SUCCESS_TOAST_MS });
}

export function notifyError(
  message: string,
  action?: { label: string; onClick: () => void },
): void {
  toast.error(message, { duration: Number.POSITIVE_INFINITY, closeButton: true, action });
}

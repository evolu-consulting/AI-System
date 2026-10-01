// ADM-FR-60 · toast theo ui-admin §6: thành công tự ẩn sau 4 giây (role status), lỗi phải bấm đóng mới mất (role alert).
// Sonner không gắn role cho toast nên bọc nội dung bằng phần tử có role để đọc được bằng trình đọc màn hình và e2e.
import { toast } from "sonner";

export const SUCCESS_TOAST_MS = 4000;

/** `action` (vd "Hoàn tác") và `durationMs` (vd 5000 cho Hoàn tác) tuỳ chọn; mặc định 4 giây, không nút. */
export function notifySuccess(
  message: string,
  action?: { label: string; onClick: () => void },
  durationMs: number = SUCCESS_TOAST_MS,
): void {
  toast.success(<output>{message}</output>, { duration: durationMs, action });
}

export function notifyError(
  message: string,
  action?: { label: string; onClick: () => void },
): void {
  toast.error(<span role="alert">{message}</span>, {
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    action,
  });
}

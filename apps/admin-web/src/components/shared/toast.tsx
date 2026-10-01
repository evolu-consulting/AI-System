// ADM-FR-60 · toast theo ui-admin §6: thành công tự ẩn sau 4 giây (role status), lỗi phải bấm đóng mới mất (role alert).
// Sonner không gắn role cho toast nên bọc nội dung bằng phần tử có role để đọc được bằng trình đọc màn hình và e2e.
import { toast } from "sonner";

export const SUCCESS_TOAST_MS = 4000;

export function notifySuccess(message: string): void {
  toast.success(<output>{message}</output>, { duration: SUCCESS_TOAST_MS });
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

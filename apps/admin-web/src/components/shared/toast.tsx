// ADM-FR-60 · toast theo ui-admin §6: thành công tự ẩn sau 4 giây (role status), lỗi phải bấm đóng mới mất (role alert).
// Sonner không gắn role cho toast nên bọc nội dung bằng phần tử có role để đọc được bằng trình đọc màn hình và e2e;
// nút hành động (Hoàn tác, Tải lại, "Xem …") nằm **trong** phần tử có role để trình đọc và e2e tìm thấy cùng toast.
import type { ReactNode } from "react";
import { toast } from "sonner";

export const SUCCESS_TOAST_MS = 4000;

type ToastAction = { label: string; onClick: () => void };

function ActionButton({ action, id }: { action: ToastAction; id: () => string | number }) {
  return (
    <button
      type="button"
      onClick={() => {
        action.onClick();
        toast.dismiss(id());
      }}
      className="ml-3 rounded-sm px-1 font-medium text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {action.label}
    </button>
  );
}

function body(
  message: string,
  action: ToastAction | undefined,
  id: () => string | number,
): ReactNode[] {
  return [message, action ? <ActionButton key="action" action={action} id={id} /> : null];
}

/** `action` (vd "Hoàn tác") và `durationMs` (vd 5000 cho Hoàn tác) tuỳ chọn; mặc định 4 giây, không nút. */
export function notifySuccess(
  message: string,
  action?: ToastAction,
  durationMs: number = SUCCESS_TOAST_MS,
): void {
  let id: string | number = "";
  id = toast.success(<output>{body(message, action, () => id)}</output>, { duration: durationMs });
}

/** Thông báo không phải lỗi cứng (vd ma trận đã tự tải lại sau khi entitlement bị thu hồi): role status, tự ẩn sau 8 giây. */
export function notifyInfo(message: string): void {
  toast.info(<output>{message}</output>, { duration: 8000 });
}

export function notifyError(message: string, action?: ToastAction): void {
  let id: string | number = "";
  id = toast.error(<span role="alert">{body(message, action, () => id)}</span>, {
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
  });
}

// CR-125 G3 · MỘT toast cho mọi app (audit #20). Quy ước (CR-134 Q11): thành công và lỗi cùng tự ẩn sau 3 giây (lỗi vẫn có nút đóng, role alert);
// lỗi CÓ nút hành động (Tải lại, Thử lại…) ở lại tới khi bấm — kẻo mất nút sau 3 giây; thông tin tự ẩn sau 8 giây (role status).
// Sonnet không gắn role nên nội dung được bọc phần tử có role; nút hành động (Hoàn tác, Tải lại…) nằm TRONG phần tử có role.
// sonner tải lười (CR-118 bundle): không vào chunk chính của app; mọi app chỉ import toast từ đây (check:toast).
import type { ReactNode } from "react";

export const SUCCESS_TOAST_MS = 3000;
export const ERROR_TOAST_MS = 3000;
export const INFO_TOAST_MS = 8000;

export type ToastAction = { label: string; onClick: () => void };
type SonnerMod = typeof import("sonner");
type SonnerOpts = NonNullable<Parameters<SonnerMod["toast"]["success"]>[1]>;
export type ToastOptions = SonnerOpts;
export type ToastKind = "ok" | "late";

const sonner = (): Promise<SonnerMod> => import("sonner");

function ActionButton({ action, onDone }: { action: ToastAction; onDone: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        action.onClick();
        onDone();
      }}
      className="ml-3 rounded-sm px-1 font-medium text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {action.label}
    </button>
  );
}

function body(
  message: ReactNode,
  action: ToastAction | undefined,
  onDone: () => void,
): ReactNode[] {
  return [message, action ? <ActionButton key="action" action={action} onDone={onDone} /> : null];
}

type Kind = "success" | "info" | "warning" | "error";

async function show(
  kind: Kind,
  message: ReactNode,
  opts: ToastOptions & { action?: ToastAction } = {},
): Promise<string | number> {
  const { toast: s } = await sonner();
  const { action, ...rest } = opts;
  let id: string | number = rest.id ?? "";
  const dismiss = () => void s.dismiss(id);
  const content =
    kind === "error" || kind === "warning" ? (
      <span role="alert">{body(message, action, dismiss)}</span>
    ) : (
      <output>{body(message, action, dismiss)}</output>
    );
  const defaults: ToastOptions =
    kind === "error"
      ? { duration: action ? Number.POSITIVE_INFINITY : ERROR_TOAST_MS, closeButton: true }
      : { duration: kind === "info" ? INFO_TOAST_MS : SUCCESS_TOAST_MS };
  id = s[kind](content, { ...defaults, ...rest });
  return id;
}

/** `action` (vd "Hoàn tác") và `durationMs` (vd 5000 cho Hoàn tác) tuỳ chọn; mặc định 3 giây, không nút. */
export function notifySuccess(
  message: string,
  action?: ToastAction,
  durationMs = SUCCESS_TOAST_MS,
): void {
  void show("success", message, { action, duration: durationMs });
}

/** Thông báo không phải lỗi cứng: role status, tự ẩn sau 8 giây. */
export function notifyInfo(message: string): void {
  void show("info", message);
}

/**
 * Lỗi: tự tắt sau 3 giây (có nút đóng); có `action` thì ở lại tới khi bấm. `position: "top-center"` cho màn có thanh Lưu ở góc dưới phải (trình sửa quy trình): toast
 * ở lại không được đè nút Lưu, nếu không người dùng sửa xong cũng không bấm Lưu lại được.
 */
export function notifyError(
  message: string,
  action?: ToastAction,
  position?: "top-center" | "bottom-right",
): void {
  void show("error", message, position ? { action, position } : { action });
}

/** Lý do từ chối thao tác trên canvas: giữa-trên (không đè thanh Lưu), tự đóng sau 3 giây. */
export function notifyBrief(message: string, action?: ToastAction): void {
  void show("error", message, { action, duration: SUCCESS_TOAST_MS, position: "top-center" });
}

type Show = (
  message: ReactNode,
  opts?: ToastOptions & { action?: ToastAction },
) => Promise<string | number>;
const bind =
  (k: Kind): Show =>
  (m, o) =>
    show(k, m, o);

/** Trung tính (không icon/role riêng): giữ nguyên nội dung và `action` gốc của sonner. */
async function plain(message: ReactNode, opts?: ToastOptions): Promise<string | number> {
  const { toast: s } = await sonner();
  return s.message(message, opts);
}

/**
 * Kiểu gọi gọn: `toast("Đã lưu")` / `toast("Lỗi", "late")` / `toast(<nội dung có role>, {action})` (trung tính)
 * và `toast.success/info/warning/error/message/dismiss(...)`.
 */
export const toast = Object.assign(
  (message: ReactNode, arg?: ToastKind | ToastOptions): Promise<string | number> => {
    if (arg === "late") return show("error", message);
    if (arg === "ok" || (arg === undefined && typeof message === "string"))
      return show("success", message);
    return plain(message, arg);
  },
  {
    success: bind("success"),
    info: bind("info"),
    warning: bind("warning"),
    error: bind("error"),
    message: plain,
    dismiss: async (id?: string | number): Promise<void> => {
      const { toast: s } = await sonner();
      s.dismiss(id);
    },
  },
);

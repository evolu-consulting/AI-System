// CR-056 · P-a Bước 0: STUB PF1 — nút "Huỷ lượt chạy" + xác nhận. RunPage (PF3) cũng dùng (readiness #4): giữ chữ ký.
export type CancelRunButtonProps = {
  runId: string;
  /** `can_cancel` của view; false/vắng ⇒ không vẽ nút. */
  canCancel: boolean | undefined;
  /** Đã huỷ xong (đóng pane / cập nhật trang). */
  onCancelled?: () => void;
};

export function CancelRunButton(_props: CancelRunButtonProps) {
  return null;
}

// CR-056 · P-a Bước 0: STUB PF2 — nút "Nhờ người khác trả lời"/"Chuyển người khác kiểm". Chữ ký do Bước 0 giữ: PF1 (thẻ kiểm) gọi, PF2 hiện thực.
import type { TaskKind } from "@ai/contracts/chat";

export type ForwardActionProps = {
  taskId: string;
  kind: TaskKind;
  /** Lần chuyển hiện có (0..FORWARD_CHAIN_MAX); đủ trần ⇒ nút khoá. */
  forwardCount: number;
  /** Chuyển xong (cập nhật view). */
  onForwarded?: () => void;
};

export function ForwardAction(_props: ForwardActionProps) {
  return null;
}

// CHAT-AC-57: chữ ký của `ForwardAction` (Bước 0 giữ; PF1 gọi). Tách riêng để Action ↔ Dialog không vòng import.
import type { TaskKind } from "@ai/contracts/chat";

export type ForwardActionProps = {
  taskId: string;
  kind: TaskKind;
  /** Lần chuyển hiện có (0..FORWARD_CHAIN_MAX); đủ trần ⇒ nút khoá. */
  forwardCount: number;
  /** Chuyển xong (cập nhật view). */
  onForwarded?: () => void;
  /** Người đã được nhờ (ẩn khỏi danh sách tìm). */
  excludeIds?: ReadonlySet<string>;
};

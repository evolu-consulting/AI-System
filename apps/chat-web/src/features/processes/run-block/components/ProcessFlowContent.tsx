// CR-056 · P-a Bước 0: STUB PF1 — nội dung pane thread quy trình (`FlowHeader`, thanh trạng thái, `role="log"`, `ProcessThreadFooter`).
// `RoomFlowPane` rẽ vào đây khi `useFlowKind() === "process"`; nhận cùng props với `RoomFlowContent` + slot của `FlowFrame`.
import type { FlowFrameSlot } from "~/features/flow-panel/components/FlowFrame";
import type { RoomFlowProps } from "~/features/rooms/components/flow/RoomFlowContent";

export type ProcessFlowContentProps = RoomFlowProps & FlowFrameSlot;

export function ProcessFlowContent(_props: ProcessFlowContentProps) {
  return null;
}

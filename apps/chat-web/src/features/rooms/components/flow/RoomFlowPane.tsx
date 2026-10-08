// HUB-FR-101 · X2b D10: khung thread của phòng = `FlowFrame` (aside "Flow đang mở" ≥ 640 / sheet < 640) + `RoomFlowContent`.
// Nạp lười (`React.lazy` ở `RoomView`): chỉ tải khi có `?flow=`.
import { FlowFrame } from "~/features/flow-panel/components/FlowFrame";
import { RoomFlowContent, type RoomFlowProps } from "./RoomFlowContent";

export function RoomFlowPane(props: RoomFlowProps) {
  // Dừng nằm trên khối run (không ở composer) ⇒ Esc luôn đóng khung.
  return (
    <FlowFrame running={false} onClose={props.onClose}>
      {(slot) => <RoomFlowContent {...props} {...slot} />}
    </FlowFrame>
  );
}

// HUB-FR-101 · X2b D10: khung thread của phòng = `FlowFrame` (aside "Flow đang mở" ≥ 640 / sheet < 640) + nội dung theo loại thread.
// P-a thread §6 #6: `useFlowKind` rẽ `process` ⇒ `ProcessFlowContent` (PF1, nạp lười, trong `ThreadBindingProvider`); `agent` ⇒ `RoomFlowContent` X2b không đổi.
// Nạp lười (`React.lazy` ở `RoomView`): chỉ tải khi có `?flow=`.
import { lazy, Suspense } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { FlowFrame } from "~/features/flow-panel/components/FlowFrame";
import { ThreadBindingProvider } from "~/features/processes/shared/thread/thread-binding";
import { useFlowKind } from "../../hooks/use-flow-kind";
import { RoomFlowContent, type RoomFlowProps } from "./RoomFlowContent";

const ProcessFlowContent = lazy(() =>
  import("~/features/processes/run-block/components/ProcessFlowContent").then((m) => ({
    default: m.ProcessFlowContent,
  })),
);

export function RoomFlowPane(props: RoomFlowProps) {
  const kind = useFlowKind(props.roomId, props.flowId);
  // Dừng nằm trên khối run (không ở composer) ⇒ Esc luôn đóng khung.
  return (
    <FlowFrame running={false} onClose={props.onClose}>
      {(slot) => {
        if (kind === "loading") {
          return (
            <div className="flex flex-col gap-3 p-4" aria-busy="true">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          );
        }
        if (kind === "process") {
          return (
            <ThreadBindingProvider>
              <Suspense fallback={null}>
                <ProcessFlowContent {...props} {...slot} />
              </Suspense>
            </ThreadBindingProvider>
          );
        }
        return <RoomFlowContent {...props} {...slot} />;
      }}
    </FlowFrame>
  );
}

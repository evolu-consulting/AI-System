// CHAT-AC-17 · < 640px: Sheet đáy ~83vh "Flow đang mở" (khung `FlowBottomSheet`), ✕ / "Thu nhỏ flow" đóng.
import { FlowContent, type FlowContentProps } from "./FlowContent";
import { FlowBottomSheet } from "./FlowFrame";

export function FlowSheet(props: Omit<FlowContentProps, "mobile" | "composerRef">) {
  return (
    <FlowBottomSheet running={props.data.composer.running} onClose={props.onClose}>
      {(slot) => <FlowContent {...props} {...slot} />}
    </FlowBottomSheet>
  );
}

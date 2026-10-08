// CHAT-AC-14, CHAT-AC-15 · ≥ 640px: `aside "Flow đang mở"` bên phải (khung `FlowAside`); Esc đóng khi không có run.
import { FlowContent, type FlowContentProps } from "./FlowContent";
import { FlowAside } from "./FlowFrame";

export function FlowPanel(props: Omit<FlowContentProps, "mobile" | "composerRef">) {
  return (
    <FlowAside running={props.data.composer.running} onClose={props.onClose}>
      {(slot) => <FlowContent {...props} {...slot} />}
    </FlowAside>
  );
}

// CHAT-AC-14..17 · khung flow theo bề rộng: ≥ 640 → FlowPanel, < 640 → FlowSheet. Đổi flow → `key` mới (thay nội dung, focus lại).
import type { Flow } from "@ai/contracts/chat";
import { useFlowPanel } from "../hooks/use-flow-panel";
import { useMinWidth } from "../hooks/use-min-width";
import { FlowPanel } from "./FlowPanel";
import { FlowSheet } from "./FlowSheet";

export const FLOW_PANEL_MIN_PX = 640;

type Props = { convId: string; flow: Flow; onClose(): void };

export function FlowPane({ convId, flow, onClose }: Props) {
  const wide = useMinWidth(FLOW_PANEL_MIN_PX);
  const data = useFlowPanel(convId, flow);
  const View = wide ? FlowPanel : FlowSheet;
  return <View convId={convId} flow={flow} data={data} onClose={onClose} />;
}

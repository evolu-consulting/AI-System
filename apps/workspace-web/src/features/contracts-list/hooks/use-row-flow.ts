// CR-118 · cr118-flow-web · huy hiệu flow cho danh sách HĐ: tóm tắt khe `contracts.approval` của các hàng trong trang — MỘT yêu cầu cho
// cả lô (≤ 100 ref), không gọi từng HĐ. Runtime chưa bật (HUB_FLOW_RUNTIME tắt) ⇒ không có dữ liệu ⇒ không huy hiệu.
import type { FlowSummaryItem } from "@ai/contracts/flow";
import { APPROVAL_SLOT } from "~/features/contract-approval/lib/flow-view";
import { useFlowSummary } from "~/platform/flow";

export function useRowFlow(items: readonly { id: string }[] | undefined) {
  const q = useFlowSummary({ slot: APPROVAL_SLOT, refs: (items ?? []).map((r) => r.id) });
  return q.data as ReadonlyMap<string, FlowSummaryItem> | undefined;
}

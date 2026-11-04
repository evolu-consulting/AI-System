// dlc-agent-flows · hàm thuần: hàng def thư viện → `DlcFlowList` (đủ 3 khe DLC, khe chưa có def ⇒ `defs: []`) và kiểm
// `runtime_options.dlc_flows` của agent theo def ĐÃ xuất bản của đúng khe.
import {
  DLC_FLOW_MODES,
  type DlcFlowList,
  type DlcFlows,
  dlcFlowSlotOf,
} from "@ai/contracts/studio";
import type { DlcDefRow } from "./dlc-flows.repo";

export const DLC_FLOW_SLOTS = DLC_FLOW_MODES.map(dlcFlowSlotOf);

export function toDlcFlowList(rows: readonly DlcDefRow[]): DlcFlowList {
  return {
    items: DLC_FLOW_MODES.map((mode) => ({
      mode,
      slot: dlcFlowSlotOf(mode),
      defs: rows
        .filter((r) => r.slot === dlcFlowSlotOf(mode))
        .map((r) => ({ key: r.key, name: r.name, published_version: Number(r.published_version) })),
    })),
  };
}

/** Dây chuyền mà key đã chọn không còn là def xuất bản của khe đó (rỗng ⇒ hợp lệ). */
export function dlcFlowProblems(flows: DlcFlows, rows: readonly DlcDefRow[]): string[] {
  const ok = new Set(rows.map((r) => `${r.slot}|${r.key}`));
  return DLC_FLOW_MODES.filter((m) => {
    const key = flows[m];
    return key !== undefined && !ok.has(`${dlcFlowSlotOf(m)}|${key}`);
  });
}

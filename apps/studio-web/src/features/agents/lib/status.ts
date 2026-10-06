// HUB-FR-60 · H4a-R06, R07, R11 · các vị từ trạng thái dùng chung cho bảng, banner và menu.
import { type AgentListItem, ORCHESTRATOR_RUNTIMES } from "@ai/contracts/studio";

/** Đang là Orchestrator (mặc định hoặc của tenant) ⇒ không tắt/xoá được (R06). */
export const isOrchestrator = (a: AgentListItem): boolean =>
  a.orchestrator_of.default || a.orchestrator_of.tenant_ids.length > 0;

/** Menu "Đặt làm Orchestrator": ẩn khi runtime không hỗ trợ, đang tắt, hoặc đã là mặc định. */
export const canSetAsOrchestrator = (a: AgentListItem): boolean =>
  a.enabled &&
  !a.orchestrator_of.default &&
  (ORCHESTRATOR_RUNTIMES as readonly string[]).includes(a.runtime);

/** Banner "Cần chú ý": agent bật nhưng chưa cấp tenant nào. */
export const enabledButNotGranted = (items: readonly AgentListItem[]): AgentListItem[] =>
  items.filter((a) => a.enabled && a.entitled_tenant_count === 0);

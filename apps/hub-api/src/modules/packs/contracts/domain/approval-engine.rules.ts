// Luật thuần (lớp 1) cho thẻ duyệt HĐ trên engine: `finalizesOnApprove` (bước mở là bước review áp dụng cuối), lý do kẹt, facts rẽ nhánh,
// đối soát run đã kết thúc. (CR-127 Z3b: gỡ ánh xạ bước engine ↔ bước người dùng, route/finalize của máy cũ.)
import { type FlowFacts, type FlowStep, stepApplies } from "./approval-flow.rules";
import type { FlowDeal } from "./approval-flow.types";

/** Đạt bước mở `open` sẽ ghi "Đã duyệt" khi không còn bước review nào áp dụng sau nó (bước Dify sau đó tự chạy). */
export function finalizesOnApprove(
  steps: readonly FlowStep[],
  f: FlowFacts,
  open: number,
): boolean {
  if (!Number.isInteger(open) || open < 0 || open >= steps.length) return false;
  if (steps[open]?.kind !== "review") return false;
  return steps.slice(open + 1).every((s) => s.kind !== "review" || !stepApplies(s, f));
}

/** CR-107 · lý do lượt kẹt vì mẫu (ghi vào `approvals.feedback`, thẻ hiện ở `attention.reason`). */
export const FLOW_GROUP_MISSING = "FLOW_GROUP_MISSING";
export const FLOW_INVALID = "FLOW_INVALID";
/** CR-118 §11.2 · tenant có luật chọn quy trình mà người khởi tạo không khớp luật nào và không có mặc định (hoặc quy trình của
 *  luật không còn bản xuất bản) ⇒ chặn khởi tạo. */
export const FLOW_ROUTE_NONE = "FLOW_ROUTE_NONE";
/** cr118-routing-deleted · luật đã khớp nhưng quy trình của luật bị xoá / chưa xuất bản ⇒ chặn khởi tạo (lý do riêng cho UI). */
export const FLOW_ROUTE_UNAVAILABLE = "FLOW_ROUTE_UNAVAILABLE";
/** Thiếu Group ⇒ `FLOW_GROUP_MISSING:<mã,…>` (mã Group thiếu, tối đa 5, cắt 200 ký tự); không biết mã ⇒ `FLOW_GROUP_MISSING`. */
export function groupMissingReason(keys: readonly string[]): string {
  const ks = [...new Set(keys)].slice(0, 5);
  return (ks.length ? `${FLOW_GROUP_MISSING}:${ks.join(",")}` : FLOW_GROUP_MISSING).slice(0, 200);
}

const DEALS: ReadonlySet<string> = new Set(["buy", "sell", "referral"]);
/** Hàng HĐ ⇒ facts rẽ nhánh (loại lạ ⇒ null = cần bước). */
export const factsOf = (deal: string | null, totalValue: unknown): FlowFacts => ({
  deal: deal !== null && DEALS.has(deal) ? (deal as FlowDeal) : null,
  total_value: totalValue,
});

const TERMINAL_RUN: ReadonlySet<string> = new Set(["done", "failed", "cancelled", "expired"]);
export const isTerminalRun = (status: string): boolean => TERMINAL_RUN.has(status);
export type RunOutcomeLite = { status: string; rejected: boolean; feedback: string | null };
export type Reconcile =
  | { kind: "none" }
  | { kind: "reject"; feedback: string | null }
  | { kind: "stalled"; reason: string };

/** Lượt `engine` còn `level1` mà run đã kết thúc ⇒ đồng bộ HĐ: Từ chối ⇒ HĐ `reject`; còn lại (huỷ ngoài luồng, lỗi, mất, hết hạn,
 *  xong mà lượt chưa ghi) ⇒ `stalled`: GIỮ chế độ engine (không bao giờ về máy cũ — máy cũ lách head_only/luồng), ghi lý do, chờ
 *  owner/admin "Mở lại quy trình". Run còn chạy ⇒ không làm gì. */
export function reconcileOf(o: RunOutcomeLite | undefined): Reconcile {
  if (!o) return { kind: "stalled", reason: "ENGINE_RUN_MISSING" };
  if (!TERMINAL_RUN.has(o.status)) return { kind: "none" };
  if (o.rejected) return { kind: "reject", feedback: o.feedback };
  return { kind: "stalled", reason: `ENGINE_RUN_${o.status.toUpperCase()}` };
}

// contract-flow S4: luật hiển thị thẻ duyệt khi lượt chạy trên engine (`mode = 'engine'`) — thuần, không React.
// Nút: bước soạn (idx 0) = "Xác nhận và lưu" như máy cũ; bước ≥ 1 = Đạt / Trả lại / Từ chối. Dòng thời gian = `steps[]` + tên phòng
// (`GET /pack/contracts/groups`). Lượt bị trả về máy cũ do engine hỏng/hết hạn mang lý do `ENGINE_RUN_<STATUS>` trong `feedback`.
import type { ApprovalCardStep, ContractApproval, ContractGroup } from "@ai/contracts";
import type { ApprovalView } from "./approval";

const NONE: ApprovalView = {
  confirm: false,
  approve: false,
  reject: false,
  redo: false,
  note: null,
};

export const openStepOf = (a: ContractApproval | undefined): ApprovalCardStep | null =>
  a?.steps?.find((s) => s.status === "open") ?? null;

/** Ghi chú khi người xem không quyết được bước đang mở: vì sao (chỉ xem / người gửi / chỉ trưởng phòng / không thuộc nhóm). */
function blockedNote(a: ContractApproval, open: ApprovalCardStep, write: boolean): string {
  if (!write) return "contracts.approval.blocked.viewOnly";
  if (a.block_reason === "starter") return "contracts.approval.engine.blocked.starter";
  if (a.block_reason === "not_reviewer")
    return open.head_only
      ? "contracts.approval.engine.blocked.headOnly"
      : "contracts.approval.engine.blocked.notReviewer";
  return "contracts.approval.engine.waiting";
}

/** Luật nút + ghi chú cho thẻ engine. Trả lại chỉ từ bước ≥ 1 (bước soạn không có nơi để trả về). */
export function engineApprovalView(
  a: ContractApproval,
  o: { write: boolean; hasSource: boolean },
): ApprovalView {
  if (a.step === "extract") return { ...NONE, note: "contracts.approval.working" };
  if (a.step !== "level1") return NONE;
  const open = openStepOf(a);
  if (!open) return NONE;
  if (!(o.write && a.can_act)) return { ...NONE, note: blockedNote(a, open, o.write) };
  if (open.idx === 0) return { ...NONE, confirm: true, reject: true, redo: o.hasSource };
  return { ...NONE, reject: true, pass: true, back: true };
}

export type TimelineRow = {
  idx: number;
  name: string;
  /** Tên phòng (null ở bước Dify); thiếu trong `/groups` ⇒ "" (UI ẩn, không lộ id). */
  group: string | null;
  headOnly: boolean;
  status: ApprovalCardStep["status"];
  /** Nhãn hạn: quá hạn (bước đang mở, qua `due_at`) hoặc đã chuyển cấp. */
  due: { at: string; flag: "overdue" | "escalated" | null } | null;
  escalatedTo: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  feedback: string | null;
};

const nameOf = (groups: readonly ContractGroup[], id: string | null): string | null =>
  id === null ? null : (groups.find((g) => g.id === id)?.name ?? "");

/** `steps[]` ⇒ dòng thời gian. `now` (ms) để test không phụ thuộc đồng hồ. */
export function timelineRows(
  steps: readonly ApprovalCardStep[],
  groups: readonly ContractGroup[],
  now: number,
): TimelineRow[] {
  return steps.map((s) => {
    const overdue = s.status === "open" && s.due_at !== null && Date.parse(s.due_at) < now;
    const flag = s.escalated ? "escalated" : overdue ? "overdue" : null;
    return {
      idx: s.idx,
      name: s.name,
      group: nameOf(groups, s.group_id),
      headOnly: s.head_only,
      status: s.status,
      due: s.due_at ? { at: s.due_at, flag } : null,
      escalatedTo: s.escalated ? nameOf(groups, s.escalated_group_id) : null,
      decidedBy: s.decided_by?.name ?? null,
      decidedAt: s.decided_at,
      feedback: s.feedback,
    };
  });
}

const RELEASE = /^ENGINE_RUN_([A-Z_]+)$/;
const RELEASE_KNOWN = new Set(["MISSING", "FAILED", "CANCELLED", "EXPIRED", "COMPLETED"]);

/** Lý do lượt bị trả về máy cũ (`feedback = ENGINE_RUN_<STATUS>`) ⇒ khoá i18n; không phải mã này ⇒ null. */
export function releaseNoteKey(feedback: string | null | undefined): string | null {
  const m = RELEASE.exec(feedback ?? "");
  if (!m) return null;
  return `contracts.approval.engine.release.${RELEASE_KNOWN.has(m[1] as string) ? m[1] : "OTHER"}`;
}

/** Hạn còn lại/quá hạn tính theo giờ nguyên (làm tròn xuống), cho nhãn "còn Nh"/"quá Nh". */
export function hoursLeft(dueAt: string, now: number): number {
  const d = Date.parse(dueAt) - now;
  return d >= 0 ? Math.floor(d / 3_600_000) : -Math.floor(-d / 3_600_000);
}

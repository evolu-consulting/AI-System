// contract-flow S4: luật hiển thị thẻ duyệt khi lượt chạy trên engine (`mode = 'engine'`) — thuần, không React.
// Nút: bước soạn (idx 0) = "Xác nhận và lưu" như máy cũ; bước ≥ 1 = Đạt / Trả lại / Từ chối. Dòng thời gian = `steps[]` + tên phòng
// (`GET /pack/contracts/groups`). Lượt bị trả về máy cũ do engine hỏng/hết hạn mang lý do `ENGINE_RUN_<STATUS>` trong `feedback`.
import type { ApprovalCardStep, ContractApproval, ContractGroup, FlowCond } from "@ai/contracts";
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

/**
 * Lượt engine đang CHUYỂN bước: bước trước đã Đạt/bỏ qua nhưng bước kế (kể cả bước duyệt thêm từ quy trình thư viện, sau nút
 * `route`) chưa mở — engine mở nó bất đồng bộ. Lúc này không có bước `open` nên không có nút; phải tải lại tới khi bước mở,
 * nếu không thẻ kẹt không nút "Đạt" cho tới khi người dùng tự F5.
 */
export const engineAdvancing = (a: ContractApproval | undefined): boolean =>
  a?.mode === "engine" &&
  a.step === "level1" &&
  a.needs_reopen !== true &&
  // CR-107: run chờ quyết/kẹt (`attention`) không phải "đang chuyển bước" — chờ người xử lý, không tải lại vô hạn.
  !a.attention &&
  (a.steps?.length ?? 0) > 0 &&
  openStepOf(a) === null;

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
  if (!open)
    return engineAdvancing(a) ? { ...NONE, note: "contracts.approval.engine.advancing" } : NONE;
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
  /** CR-109 · bước chưa tới sẽ bị bỏ qua (điều kiện không thỏa); null = không. */
  skipWhen: FlowCond[] | null;
  /** CR-113 · quyết thay bởi Toàn quyền. */
  ownerOverride: boolean;
  /** CR-113 · server báo quá hạn (hoặc đã chuyển cấp) — vắng ⇒ tự tính theo `due_at`. */
  overdue: boolean;
};

const nameOf = (groups: readonly ContractGroup[], id: string | null): string | null =>
  id === null ? null : (groups.find((g) => g.id === id)?.name ?? "");

/** CR-113 · server báo `overdue` thì tin; vắng ⇒ bước đang mở qua `due_at`. */
const isOverdue = (s: ApprovalCardStep, now: number): boolean =>
  s.overdue ?? (s.status === "open" && s.due_at !== null && Date.parse(s.due_at) < now);

/** `steps[]` ⇒ dòng thời gian. `now` (ms) để test không phụ thuộc đồng hồ. */
export function timelineRows(
  steps: readonly ApprovalCardStep[],
  groups: readonly ContractGroup[],
  now: number,
): TimelineRow[] {
  return steps.map((s) => {
    const overdue = isOverdue(s, now);
    const flag = s.escalated ? "escalated" : overdue ? "overdue" : null;
    return {
      idx: s.idx,
      name: s.name,
      group: nameOf(groups, s.group_id),
      headOnly: s.head_only,
      status: s.status,
      due: s.due_at ? { at: s.due_at, flag } : null,
      escalatedTo: s.escalated ? (s.escalated_to ?? nameOf(groups, s.escalated_group_id)) : null,
      decidedBy: s.decided_by?.name ?? null,
      decidedAt: s.decided_at,
      feedback: s.feedback,
      skipWhen: s.status === "pending" && s.skip_when?.length ? s.skip_when : null,
      ownerOverride: s.decided_as === "owner_override",
      overdue,
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

const NEGATE = { ge: "lt", gt: "le", le: "gt", lt: "ge" } as const;

/** CR-109 · điều kiện không thỏa ⇒ khoá i18n + tham số cho nhãn "Sẽ bỏ qua (…)": giá trị ⇒ phép so ngược lại (≥ 500tr không thỏa ⇒ "< 500tr"). */
export function skipReason(c: FlowCond): { key: string; vars: { n: number } } {
  if (c.field === "deal") return { key: "deal", vars: { n: c.in.length } };
  // CR-121 D-0 · trường mới: điều kiện không thỏa ⇒ câu lý do theo trường.
  if (c.field === "creator_department") return { key: "department", vars: { n: c.in.length } };
  if (c.field === "new_partner") return { key: c.is ? "newPartner" : "oldPartner", vars: { n: 0 } };
  return { key: `value.${NEGATE[c.op]}`, vars: { n: c.value } };
}

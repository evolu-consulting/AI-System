// CR-127 · U5 · BR-41…56 · M9/M11: luật thuần của danh sách "Các mốc thực hiện" — trạng thái mốc, ai đang giữ việc, nút nào bấm được (+ lý do khi không).
// Server là chỗ quyết cuối (`TASK_CLAIMED`, `CONTRACT_ON_HOLD`…); ở đây chỉ quyết nút hiện + câu giải thích, không thao tác ẩn.
import type { Milestone, Obligation } from "@ai/contracts/pack-contracts";
import { type Meta, type MilestoneState, metaOf, milestoneDays, milestoneState } from "./timeline";

export type RowClaim =
  | { kind: "none" }
  | { kind: "unclaimed"; taskId: string }
  | { kind: "mine"; taskId: string }
  | { kind: "other"; taskId: string; by: string | null };

export type RowView = {
  m: Milestone;
  state: MilestoneState | "cancelled";
  meta: Meta | null;
  claim: RowClaim;
  /** Nút «Xác nhận …» bấm được. */
  canConfirm: boolean;
  canPostpone: boolean;
  /** Nút «Nhận việc» / «Trả về nhóm». */
  canClaim: boolean;
  canRelease: boolean;
  /** Vì sao không xác nhận được (hiện cạnh mốc); null = không có lý do cần nói. */
  why: "hold" | "other" | "unclaimed" | "super" | null;
  /** Mốc chưa xong mà quá hạn. */
  late: boolean;
};

export const isMoney = (k: Milestone["kind"]) =>
  k === "collect" || k === "pay" || k === "commission";

export function claimOf(ob: Obligation | undefined, me: string | null | undefined): RowClaim {
  const t = ob?.task;
  if (!t) return { kind: "none" };
  if (t.state === "unclaimed") return { kind: "unclaimed", taskId: t.task_id };
  return t.claimed_by && t.claimed_by === me
    ? { kind: "mine", taskId: t.task_id }
    : { kind: "other", taskId: t.task_id, by: t.claimed_by };
}

export type RowOpts = {
  today: string;
  nextId: string | null;
  write: boolean;
  held: boolean;
  superseded: boolean;
  userId: string | null | undefined;
  /** Quản trị gói: xác nhận được cả khi người khác đang giữ việc (server miễn). */
  admin: boolean;
};

function whyOf(base: boolean, o: RowOpts, m: Milestone, claim: RowClaim): RowView["why"] {
  if (!base) return o.superseded && m.status === "open" ? "super" : null;
  // Tạm khoá chặn giao/nhận/xác nhận mốc; vẫn ghi được tiền thu (BR-42).
  if (o.held && m.kind !== "collect") return "hold";
  if (claim.kind === "other" && !o.admin) return "other";
  if (claim.kind === "unclaimed" && !o.admin) return "unclaimed";
  return null;
}

export function rowView(m: Milestone, ob: Obligation | undefined, o: RowOpts): RowView {
  const open = m.status === "open";
  const claim = claimOf(ob, o.userId);
  const state: RowView["state"] =
    m.status === "cancelled" ? "cancelled" : milestoneState(m, o.nextId, o.today);
  const base = open && o.write && !o.superseded;
  const why = whyOf(base, o, m, claim);
  return {
    m,
    state,
    meta: state === "cancelled" ? null : metaOf(state, milestoneDays(m, o.today)),
    claim,
    canConfirm: base && why === null,
    canPostpone: base && !o.held,
    canClaim: base && claim.kind === "unclaimed" && why !== "hold",
    canRelease: base && claim.kind === "mine",
    why,
    late: open && m.due_date < o.today,
  };
}

/** Tổng quan 4 ô số (M9): giao x/y, thu x/y. Số đã xong lấy từ mốc `done`. */
export function progressStats(ms: readonly Milestone[]) {
  const live = ms.filter((m) => m.status !== "cancelled");
  const sum = (k: Milestone["kind"], f: (m: Milestone) => number | null, doneOnly: boolean) =>
    live
      .filter((m) => m.kind === k && (!doneOnly || m.status === "done"))
      .reduce((s, m) => s + (f(m) ?? 0), 0);
  const left = (k: Milestone["kind"]) =>
    live.filter((m) => m.kind === k && m.status === "open").length;
  return {
    qtyDone: sum("delivery", (m) => m.qty, true),
    qtyTotal: sum("delivery", (m) => m.qty, false),
    deliveriesLeft: left("delivery"),
    moneyDone: sum("collect", (m) => m.amount_effective, true),
    moneyTotal: sum("collect", (m) => m.amount_effective, false),
    collectsLeft: left("collect"),
  };
}

export const pctOf = (done: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

// V2-A · §5.4a · KN-04: hàng mốc (json của Postgres) → DTO `@ai/contracts` `Milestone` (loại BA, số tiền tính, đã xác nhận) +
// giai đoạn / bước hiện tại. Thuần: không đọc DB; NUMERIC/bigint về chuỗi hoặc số ⇒ `Number` (tiền ≤ 10¹⁵ an toàn).
import type { ContractProgress, Milestone } from "@ai/contracts";
import type { MilestoneRow, MilestoneWritten } from "../application/milestones.ports";
import {
  type Deal,
  effectiveAmounts,
  fromDb,
  MILESTONE_TITLES,
  moneyBase,
  nextStep,
  primaryMoneyKind,
  stageOf,
} from "../domain/milestones.rules";

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export type MoneyCtx = {
  deal: Deal | null;
  value: number | string | null;
  pct: number | string | null;
  fixed: number | string | null;
};
type Peer = Pick<MilestoneRow, "id" | "kind" | "direction" | "amount" | "status">;

/** 5.4a cho cả HĐ: id ⇒ số tiền tính (HĐ chưa rõ loại ⇒ chỉ số tiền đã ghi). */
export function amountsOf(peers: readonly Peer[], c: MoneyCtx): Map<string, number | null> {
  const ms = peers.map((p) => ({
    id: p.id,
    kind: fromDb(p.kind, p.direction),
    amount: num(p.amount),
    status: p.status,
  }));
  if (!c.deal) return new Map(ms.map((m) => [m.id, m.amount]));
  const base = moneyBase({
    deal: c.deal,
    value: num(c.value),
    pct: c.pct,
    fixed: num(c.fixed),
  });
  return effectiveAmounts(ms, base, primaryMoneyKind(c.deal));
}

export function toMilestone(r: MilestoneRow, effective: Map<string, number | null>): Milestone {
  const kind = fromDb(r.kind, r.direction);
  return {
    id: r.id,
    contract_id: r.contract_id,
    kind,
    title: r.title ?? MILESTONE_TITLES[kind],
    seq: r.seq,
    due_date: r.due_date,
    owner: r.owner,
    qty: num(r.qty),
    amount: num(r.amount),
    amount_effective: effective.get(r.id) ?? null,
    status: r.status,
    confirmed: r.status === "done",
    done_at: r.done_at,
    fault: r.fault,
    postponed_to: r.postponed_to,
    source: r.source,
  };
}

/** Kết quả một lệnh ghi (mốc + mốc khác của HĐ) ⇒ DTO mốc. */
export const toWrittenMilestone = (w: MilestoneWritten): Milestone =>
  toMilestone(w.m, amountsOf(w.peers ?? [], w));

/** Chi tiết: mọi mốc còn hiệu lực ⇒ DTO + giai đoạn + bước hiện tại (ngày lịch tenant `today`). */
export function milestonesView(
  rows: readonly MilestoneRow[],
  c: MoneyCtx & { start: string | null; today: string },
) {
  const eff = amountsOf(rows, c);
  const milestones = rows.map((r) => toMilestone(r, eff));
  return {
    milestones,
    stage: stageOf({ today: c.today, start: c.start, milestones }),
    next_milestone_id: nextStep(milestones, c.today)?.id ?? null,
  };
}

/** Danh sách: tóm tắt từ SQL (đếm + mốc mở sớm nhất) ⇒ giai đoạn + bước hiện tại, không đọc từng mốc. */
export type ProgressRaw = {
  id: string;
  deal: Deal | null;
  start_date: string | null;
  n_req: number;
  n_req_done: number;
  n_done: number;
  next: Pick<MilestoneRow, "id" | "kind" | "direction" | "title" | "due_date"> | null;
};
export function toProgress(r: ProgressRaw, today: string): ContractProgress {
  const stage =
    r.n_req > 0 && r.n_req === r.n_req_done
      ? "done"
      : r.n_done === 0 && (r.start_date === null || today < r.start_date)
        ? "not_started"
        : "in_progress";
  const n = r.next;
  const kind = n ? fromDb(n.kind, n.direction) : null;
  return {
    id: r.id,
    deal: r.deal,
    start_date: r.start_date,
    stage,
    next:
      n && kind
        ? {
            id: n.id,
            kind,
            title: n.title ?? MILESTONE_TITLES[kind],
            due_date: n.due_date,
            overdue: n.due_date < today,
          }
        : null,
  };
}

// V2-A · V2-I · ADR-0023: giai đoạn + bước hiện tại của HĐ từ tóm tắt mốc của SQL (đếm + mốc mở sớm nhất) — thuần, dùng chung cho
// danh sách HĐ (adapter `contracts.repo.ts`) và HĐ của đối tác (`partner-roles.usecase.ts`). Kiểu ra khớp `ContractProgress`.
import {
  type Deal,
  fromDb,
  MILESTONE_TITLES,
  type MilestoneKind,
} from "../domain/milestones.rules";
import type { MilestoneRow } from "./milestones.ports";

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

/** ≡ `ContractProgress` của `@ai/contracts`. */
export type ProgressView = {
  id: string;
  deal: Deal | null;
  start_date: string | null;
  stage: "not_started" | "in_progress" | "done";
  next: {
    id: string;
    kind: MilestoneKind;
    title: string;
    due_date: string;
    overdue: boolean;
  } | null;
};

export function toProgress(r: ProgressRaw, today: string): ProgressView {
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

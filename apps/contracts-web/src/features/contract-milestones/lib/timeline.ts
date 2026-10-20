// V2-F · HD-04/HD-11 · BA §3.1 · mockup `timelineV2`: dòng thời gian mốc — các nút (Ký HĐ → mốc theo hạn → Hết hiệu lực), trạng thái từng mốc
// (xong đúng hạn / xong trễ / bước hiện tại / quá hạn / sắp tới), tiến độ n/m. Ngày là chuỗi ISO `YYYY-MM-DD`. Thuần.
import type { ContractDeal, Milestone } from "@ai/contracts";

export type MilestoneKind = Milestone["kind"];
export type MilestoneState = "done" | "late" | "cur" | "over" | "up";
export type TimelineNode =
  | { type: "start" | "end"; date: string | null; past: boolean }
  | { type: "milestone"; m: Milestone; state: MilestoneState; days: number };

const DAY_MS = 86_400_000;
const parse = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** Số ngày từ `a` đến `b` (b − a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parse(b) - parse(a)) / DAY_MS);

export const MONEY_KINDS: ReadonlySet<MilestoneKind> = new Set(["collect", "pay", "commission"]);
export const KINDS: readonly MilestoneKind[] = [
  "delivery",
  "collect",
  "pay",
  "commission",
  "serial",
  "renewal",
  "other",
];

/** ≡ `defaultOwner` của máy chủ (`milestones.rules.ts`): việc của ai khi người dùng chưa chọn. */
export function defaultOwner(kind: MilestoneKind, deal: ContractDeal): "ours" | "partner" {
  if (kind === "collect" || kind === "commission") return "partner";
  if (kind === "delivery" || kind === "serial") return deal === "buy" ? "partner" : "ours";
  return "ours";
}

/** Mốc "Nhắc gia hạn" không tính vào tiến độ (≡ giai đoạn phía máy chủ). */
export const countsForProgress = (m: Pick<Milestone, "kind" | "status">): boolean =>
  m.kind !== "renewal" && m.status !== "cancelled";

export function milestoneState(
  m: Milestone,
  current: string | null,
  today: string,
): MilestoneState {
  if (m.confirmed) return m.done_at && daysBetween(m.due_date, m.done_at) > 0 ? "late" : "done";
  if (m.id === current) return "cur";
  return m.due_date < today ? "over" : "up";
}

/** Số ngày: mốc xong ⇒ (xong − hạn) (>0 trễ, <0 sớm); chưa xong ⇒ (hôm nay − hạn) (>0 quá hạn, <0 còn). */
export function milestoneDays(m: Milestone, today: string): number {
  return daysBetween(m.due_date, m.confirmed && m.done_at ? m.done_at : today);
}

/** Dòng phụ của một mốc: khoá i18n + số ngày. Chưa xong mà quá hạn (kể cả bước hiện tại) ⇒ `dueOver` (đỏ). */
export type Meta = {
  key: "doneOnTime" | "doneEarly" | "doneLate" | "dueOver" | "dueLeft";
  n: number;
};
export function metaOf(state: MilestoneState, days: number): Meta {
  if (state === "late") return { key: "doneLate", n: days };
  if (state === "done")
    return days < 0 ? { key: "doneEarly", n: -days } : { key: "doneOnTime", n: 0 };
  return days > 0 ? { key: "dueOver", n: days } : { key: "dueLeft", n: -days };
}

export function buildTimeline(
  c: {
    start_date: string | null;
    end_date: string | null;
    milestones: readonly Milestone[];
    next_milestone_id: string | null;
  },
  today: string,
): TimelineNode[] {
  const ms = c.milestones
    .filter((m) => m.status !== "cancelled")
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq);
  return [
    { type: "start", date: c.start_date, past: !!c.start_date && c.start_date <= today },
    ...ms.map(
      (m): TimelineNode => ({
        type: "milestone",
        m,
        state: milestoneState(m, c.next_milestone_id, today),
        days: milestoneDays(m, today),
      }),
    ),
    { type: "end", date: c.end_date, past: !!c.end_date && c.end_date <= today },
  ];
}

export function progressOf(milestones: readonly Milestone[]): {
  done: number;
  total: number;
  pct: number;
} {
  const req = milestones.filter(countsForProgress);
  const done = req.filter((m) => m.confirmed).length;
  return { done, total: req.length, pct: req.length ? Math.round((done / req.length) * 100) : 0 };
}

/** Bước hiện tại đang quá hạn ⇒ nhãn giai đoạn đỏ "Quá hạn". */
export const currentOverdue = (
  c: { milestones: readonly Milestone[]; next_milestone_id: string | null },
  today: string,
): boolean => {
  const cur = c.milestones.find((m) => m.id === c.next_milestone_id);
  return !!cur && !cur.confirmed && cur.due_date < today;
};
